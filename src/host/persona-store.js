/**
 * 人设资产存储（C 包存储层）：用户目录优先，包内 `personas/` 出厂资产回退。
 *
 * 目录契约：
 *   包内   personas/prompts/<key>.txt  + personas/meta.json
 *   用户   $DSH_HOME/persona-hub/prompts/<key>.txt（cfg.assets.dir 可改）
 *          $DSH_HOME/persona-hub/meta.json（与出厂 meta 合并，同名 key 用户覆盖）
 *
 * key 只允许 [a-zA-Z0-9._-]，杜绝路径穿越；正文上限 200k 字符（cfg.maxChars 仅供测试收窄）。
 * 纯 Node，零第三方依赖；watch 失败一律 fail-open，dispose 负责关闭全部句柄。
 */
import { readdirSync, readFileSync, statSync, watch } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { bool } from './config-values.js'

export const KEY_RE = /^[a-z][a-z0-9_-]{0,31}$/
export const SHIPPED_PROMPTS_DIR = resolve(fileURLToPath(new URL('../../personas/prompts/', import.meta.url)))
export const SHIPPED_META_PATH = fileURLToPath(new URL('../../personas/meta.json', import.meta.url))

const MAX_CHARS = 200_000
const MAX_SOURCE_BYTES = MAX_CHARS * 4 // UTF-8 每字符最多 4 字节，超过即必然超字符上限
const DEBOUNCE_MS = 150

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 用户 prompts 目录；未配置 assets.dir 时落 $DSH_HOME/persona-hub/prompts。 */
export function resolvePromptsDir(cfg = {}) {
  const dir = cfg?.assets?.dir
  if (dir && String(dir).trim()) return resolve(String(dir))
  return join(dshHome(), 'persona-hub', 'prompts')
}

/** 用户 meta 文件（覆盖出厂 meta 用）；cfg 仅保留签名位，路径固定落在 DSH_HOME。 */
export function resolveMetaPath(cfg = {}) {
  void cfg
  return join(dshHome(), 'persona-hub', 'meta.json')
}

/** 解析单个 meta 文件；坏 JSON / 坏条目一律忽略，返回已解析部分。 */
function parseMetaFile(path) {
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!KEY_RE.test(key) || !value || typeof value !== 'object' || Array.isArray(value)) continue
    out[key] = {
      name: String(value.name ?? ''),
      avatar: String(value.avatar ?? ''),
      description: String(value.description ?? ''),
    }
  }
  return out
}

/** shipped meta + 用户 meta；同名 key 整体以用户条目为准。 */
export function loadMeta(cfg = {}) {
  return { ...parseMetaFile(SHIPPED_META_PATH), ...parseMetaFile(resolveMetaPath(cfg)) }
}

function tryStat(path) {
  try { return statSync(path) } catch { return null }
}

/** 列表用字符数：超大文件不整读，按字节数近似（仅影响展示）。 */
function countChars(path, st) {
  if (st.size > MAX_SOURCE_BYTES) return st.size
  try { return readFileSync(path, 'utf8').replace(/^\uFEFF/, '').length } catch { return st.size }
}

/** 用户 + 出厂合并列表；同名 key 用户优先；按 key 升序。 */
export function listPersonas(cfg = {}) {
  const meta = loadMeta(cfg)
  const seen = new Map()
  const layers = [
    [resolvePromptsDir(cfg), 'user'],
    [SHIPPED_PROMPTS_DIR, 'shipped'],
  ]
  for (const [dir, origin] of layers) {
    let files
    try { files = readdirSync(dir) } catch { continue }
    for (const file of files) {
      if (!file.endsWith('.txt')) continue
      const key = file.slice(0, -4)
      if (!KEY_RE.test(key) || seen.has(key)) continue
      const path = join(dir, file)
      const st = tryStat(path)
      if (!st || !st.isFile()) continue
      const m = meta[key] || {}
      seen.set(key, {
        key,
        name: String(m.name || key),
        avatar: String(m.avatar || ''),
        description: String(m.description || ''),
        chars: countChars(path, st),
        mtime: st.mtimeMs,
        origin,
      })
    }
  }
  return [...seen.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/**
 * 读取单角色正文。
 * @returns {{ok:true,key:string,text:string,meta:{name:string,avatar:string,description:string},mtime:number}
 *          | {ok:false,error:'invalid_key'|'persona_missing'|'persona_too_large'|'persona_unreadable'}}
 */
export function readPersona(cfg, key) {
  const k = String(key ?? '')
  if (!KEY_RE.test(k)) return { ok: false, error: 'invalid_key' }
  const rawMax = Number(cfg?.maxChars)
  const max = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : MAX_CHARS

  for (const dir of [resolvePromptsDir(cfg), SHIPPED_PROMPTS_DIR]) {
    const path = join(dir, `${k}.txt`)
    let st
    try {
      st = statSync(path)
    } catch (err) {
      // 用户层缺失才继续回退出厂层；其他错误（权限等）说明文件存在但读不了。
      if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') continue
      return { ok: false, error: 'persona_unreadable' }
    }
    if (!st.isFile()) return { ok: false, error: 'persona_unreadable' }
    // 字节数超过 max*4 时字符数必然超限，先挡住超大文件；否则按字符数精确判断。
    if (st.size > max * 4) return { ok: false, error: 'persona_too_large' }
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      return { ok: false, error: 'persona_unreadable' }
    }
    text = text.replace(/^\uFEFF/, '')
    if (text.length > max) return { ok: false, error: 'persona_too_large' }
    const m = loadMeta(cfg)[k] || {}
    return {
      ok: true,
      key: k,
      text,
      meta: { name: String(m.name || k), avatar: String(m.avatar || ''), description: String(m.description || '') },
      mtime: st.mtimeMs,
    }
  }
  return { ok: false, error: 'persona_missing' }
}

/**
 * 监听两个 prompts 目录 + meta 文件，150ms 防抖后回调。
 * @returns {() => void} dispose（幂等；关闭全部 watcher 并清定时器）
 */
export function watchPersonas(cfg = {}, onChange) {
  const empty = () => {}
  // assets.watch 是 .volatile() 字段（Ref）：必须 bool() 解包，不能直接比较对象。
  if (!bool(cfg?.assets?.watch, true)) return empty
  const notify = typeof onChange === 'function' ? onChange : empty
  const watchers = []
  let timer = null
  let disposed = false

  const fire = () => {
    timer = null
    if (disposed) return
    try { notify() } catch { /* 通知方异常不影响监听 */ }
  }

  const bump = () => {
    if (disposed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(fire, DEBOUNCE_MS)
  }

  const addWatcher = (target, filter) => {
    try {
      const w = watch(target, { persistent: true }, (event, filename) => {
        if (disposed) return
        if (filter && !filter(filename)) return
        bump()
      })
      w.on?.('error', () => { try { w.close() } catch { /* 已关闭 */ } })
      watchers.push(w)
    } catch { /* 目录/文件不存在或无权限：静默降级 */ }
  }

  const dirs = new Set([resolvePromptsDir(cfg), SHIPPED_PROMPTS_DIR])
  for (const dir of dirs) addWatcher(dir, null)

  // 监听 meta 的父目录而非文件名本身：这样创建与"rename 替换"都能收到；
  // 同时避免同目录其它文件造成的空转（按文件名过滤）。
  const metaPath = resolveMetaPath(cfg)
  addWatcher(dirname(metaPath), (filename) => {
    if (!filename) return true
    return String(filename) === 'meta.json'
  })

  return () => {
    if (disposed) return
    disposed = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    for (const w of watchers) {
      try { w.close() } catch { /* 已关闭 */ }
    }
    watchers.length = 0
  }
}
