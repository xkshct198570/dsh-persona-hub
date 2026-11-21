/**
 * 人设资产写入/删除（用户目录），以及"是否正在被使用"的引用扫描。
 *
 * 边界：
 * - 只写用户目录（`assets.dir` / `$DSH_HOME/persona-hub/prompts`）与用户 meta.json；
 *   出厂 `personas/prompts` 只读，不允许删除/覆盖。
 * - 写盘一律 tmp + fsync + rename；目录 0700、文件 0600。
 * - 删除只删用户副本；若某个 key 仍被 DSH/bots 引用，调用方需带 force 或先改配置。
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  KEY_RE, SHIPPED_PROMPTS_DIR, loadMeta, readPersona, resolveMetaPath, resolvePromptsDir,
} from './persona-store.js'

const MAX_TEXT = 200_000

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
  const fd = openSync(tmp, 'w', 0o600)
  try {
    writeSync(fd, text, null, 'utf8')
    fsyncSync(fd)
  } finally { closeSync(fd) }
  renameSync(tmp, path)
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

  const dir = resolvePromptsDir(cfg)
  const target = join(dir, `${key}.txt`)
  const shipped = join(SHIPPED_PROMPTS_DIR, `${key}.txt`)
  if (existsSync(target) && !input?.overwrite) return { ok: false, error: 'persona_exists' }
  if (!existsSync(target) && existsSync(shipped) && !input?.overwrite) {
    // 出厂同名：允许覆盖成用户副本，但必须显式 overwrite，避免误改"大肥鱼"
    return { ok: false, error: 'persona_exists_shipped' }
  }
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
  if (config?.dsh?.enabled !== false && String(config?.dsh?.defaultPersona || '') === k) {
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
  const dir = resolvePromptsDir(cfg)
  const target = join(dir, `${key}.txt`)
  if (!existsSync(target)) {
    return { ok: false, error: existsSync(join(SHIPPED_PROMPTS_DIR, `${key}.txt`)) ? 'persona_shipped_immutable' : 'persona_missing' }
  }
  if (!opts.force) {
    const usage = findPersonaUsage(opts.config, key)
    if (usage.length) return { ok: false, error: 'persona_in_use', usage }
  }
  try { unlinkSync(target) } catch (err) { return { ok: false, error: 'persona_unreadable', detail: String(err?.message || err) } }
  const metaPath = resolveMetaPath(cfg)
  const meta = readUserMeta(cfg)
  if (meta[key]) { delete meta[key]; atomicWrite(metaPath, JSON.stringify(meta, null, 2) + '\n') }
  return { ok: true, key }
}

/** 面板辅助：key 是否可删（用户副本存在）；出厂且无用户副本 → false。 */
export function isUserPersona(cfg, key) {
  return existsSync(join(resolvePromptsDir(cfg), `${key}.txt`))
}

export function personaMeta(cfg, key) {
  return loadMeta(cfg)[key] || null
}

export { readPersona }
