/**
 * 人设资产写入/删除（用户目录），以及"是否正在被使用"的引用扫描。
 *
 * 边界：
 * - 只写用户目录（`assets.dir` / `$DSH_HOME/persona-hub/prompts`）与用户 meta.json；
 *   出厂 `personas/prompts` 只读，不允许删除/覆盖。
 * - 写盘一律 tmp + fsync + rename；目录 0700、文件 0600。
 * - 删除只删用户副本；若某个 key 仍被 DSH/bots 引用，调用方需带 force 或先改配置。
 */
import { accessSync, closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  KEY_RE, SHIPPED_PROMPTS_DIR, loadMeta, readPersona, resolveMetaPath, resolvePromptsDir,
} from './persona-store.js'
import { isEnabled } from './config-values.js'

const MAX_TEXT = 200_000

/** 路径按真实目标归一：symlink 指向出厂目录时也必须识别为只读。 */
function canonicalDir(path) {
  try { return realpathSync(path) } catch { return resolve(path) }
}

/** 用户目录指向插件出厂目录时禁止写删：否则面板能改坏/删掉随包发布的资产。 */
function writesShippedDir(cfg) {
  return canonicalDir(resolvePromptsDir(cfg)) === canonicalDir(SHIPPED_PROMPTS_DIR)
}

/** 读用户 meta（不带出厂合并），用于安全地追加/删除，不把出厂键复制进用户文件。 */
function readUserMeta(cfg) {
  const path = resolveMetaPath(cfg)
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch { return {} }
}

function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  let fd
  try {
    fd = openSync(tmp, 'w', 0o600)
    writeSync(fd, text, null, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(tmp, path)
  } catch (err) {
    // 失败时尽量清掉半截 tmp：EACCES/ENOSPC 时不把垃圾留在用户目录。
    if (fd !== undefined) { try { closeSync(fd) } catch { /* 已关闭 */ } }
    try { unlinkSync(tmp) } catch { /* 未创建或已清理 */ }
    throw err
  }
}

/**
 * 资产目录可写性（面板只读态）：目录不存在时沿父目录上溯，找最近的可写祖先。
 * @param {string} dir
 * @returns {{ok:true}|{ok:false, reason:'is_file'|'not_writable'}}
 */
export function checkDirWritable(dir) {
  let current = resolve(String(dir || ''))
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const st = statSync(current)
      if (!st.isDirectory()) return { ok: false, reason: 'is_file' }
      accessSync(current, constants.W_OK)
      return { ok: true }
    } catch (err) {
      if (err?.code === 'ENOENT') {
        const parent = dirname(current)
        if (parent === current) return { ok: false, reason: 'not_writable' }
        current = parent
        continue
      }
      return { ok: false, reason: 'not_writable' }
    }
  }
  return { ok: false, reason: 'not_writable' }
}

/**
 * @param {any} cfg
 * @param {{ key: string, name?: string, avatar?: string, text: string, overwrite?: boolean }} input
 */
export function importPersona(cfg, input) {
  const key = String(input?.key || '').trim()
  if (!KEY_RE.test(key)) return { ok: false, error: 'invalid_key' }
  const text = String(input?.text ?? '')
  if (!text.trim()) return { ok: false, error: 'empty_text' }
  if (text.length > MAX_TEXT) return { ok: false, error: 'text_too_large' }
  if (writesShippedDir(cfg)) return { ok: false, error: 'assets_dir_shipped' }

  const dir = resolvePromptsDir(cfg)
  const target = join(dir, `${key}.txt`)
  const shipped = join(SHIPPED_PROMPTS_DIR, `${key}.txt`)
  if (existsSync(target) && !input?.overwrite) return { ok: false, error: 'persona_exists' }
  if (!existsSync(target) && existsSync(shipped) && !input?.overwrite) {
    // 出厂同名：允许覆盖成用户副本，但必须显式 overwrite，避免误改"大肥鱼"
    return { ok: false, error: 'persona_exists_shipped' }
  }
  // 写盘前置检查：只读目录不先写正文再在 meta 写盘时炸掉（留下半套资产）。
  const preflight = writePreflight(cfg, dir)
  if (preflight) return preflight
  atomicWrite(target, text)

  const metaPath = resolveMetaPath(cfg)
  const meta = readUserMeta(cfg)
  meta[key] = {
    name: String(input?.name || key),
    avatar: String(input?.avatar || ''),
    ...(input?.description ? { description: String(input.description) } : {}),
  }
  atomicWrite(metaPath, JSON.stringify(meta, null, 2) + '\n')
  return { ok: true, key, chars: text.length, origin: 'user' }
}

/** 找出该 key 在 Config 里的引用（dsh 默认 / bot 默认 / 绑定）。 */
export function findPersonaUsage(config, key) {
  const k = String(key || '')
  const usages = []
  if (isEnabled(config?.dsh?.enabled) && String(config?.dsh?.defaultPersona || '') === k) {
    usages.push({ where: 'dsh.defaultPersona' })
  }
  for (const [botId, bot] of Object.entries(config?.bots || {})) {
    for (const ch of ['private', 'group']) {
      const c = bot?.[ch]
      if (!c) continue
      if (String(c.defaultPersona || '') === k) usages.push({ where: `bots.${botId}.${ch}.defaultPersona`, botId })
      for (const [target, value] of Object.entries(c.bindings || {})) {
        if (String(value || '') === k) usages.push({ where: `bots.${botId}.${ch}.bindings.${target}`, botId, target })
      }
    }
  }
  return usages
}

/**
 * @param {any} cfg
 * @param {string} key
 * @param {{ force?: boolean }} [opts]
 */
export function deletePersona(cfg, key, opts = {}) {
  if (!KEY_RE.test(String(key || ''))) return { ok: false, error: 'invalid_key' }
  if (writesShippedDir(cfg)) return { ok: false, error: 'assets_dir_shipped' }
  const dir = resolvePromptsDir(cfg)
  const target = join(dir, `${key}.txt`)
  if (!existsSync(target)) {
    return { ok: false, error: existsSync(join(SHIPPED_PROMPTS_DIR, `${key}.txt`)) ? 'persona_shipped_immutable' : 'persona_missing' }
  }
  if (!opts.force) {
    const usage = findPersonaUsage(opts.config, key)
    if (usage.length) return { ok: false, error: 'persona_in_use', usage }
  }
  // 写盘前置检查：只读目录不应先删正文再在 meta 写盘时炸掉。
  const preflight = writePreflight(cfg, dir)
  if (preflight) return preflight
  try { unlinkSync(target) } catch (err) { return { ok: false, error: 'persona_unreadable', detail: String(err?.message || err) } }
  const metaPath = resolveMetaPath(cfg)
  const meta = readUserMeta(cfg)
  if (meta[key]) { delete meta[key]; atomicWrite(metaPath, JSON.stringify(meta, null, 2) + '\n') }
  return { ok: true, key }
}

/** 写盘前置检查：正文目录与 meta 目录都必须可写；否则返回 write_failed（不抛）。 */
function writePreflight(cfg, dir) {
  const targets = [
    [dir, 'assets_dir'],
    [dirname(resolveMetaPath(cfg)), 'meta_dir'],
  ]
  for (const [target, where] of targets) {
    const got = checkDirWritable(target)
    if (got.ok !== true) {
      return { ok: false, error: 'write_failed', detail: `${where}:${got.reason}` }
    }
  }
  return null
}

/** 面板辅助：key 是否可删（用户副本存在）；出厂且无用户副本 → false。 */
export function isUserPersona(cfg, key) {
  return existsSync(join(resolvePromptsDir(cfg), `${key}.txt`))
}

export function personaMeta(cfg, key) {
  return loadMeta(cfg)[key] || null
}

export { readPersona }
