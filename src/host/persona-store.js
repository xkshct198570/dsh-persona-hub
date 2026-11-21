/**
 * 人设文本存储：用户目录（可编辑）优先，包内 `personas/` 作为出厂资产回退。
 *
 * key 只允许字母数字._-，杜绝路径穿越；选择结果存 $DSH_HOME/persona-hub/active.json。
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const KEY_RE = /^[a-zA-Z0-9._-]{1,64}$/
export const SHIPPED_DIR = fileURLToPath(new URL('../../personas/', import.meta.url))

/** @param {{ personaDir?: string }} [cfg] */
export function resolvePersonaDir(cfg = {}) {
  if (cfg.personaDir) return String(cfg.personaDir)
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'persona-hub', 'personas')
}

function activePath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'persona-hub', 'active.json')
}

/** @returns {{ key: string, updatedAt: number } | null} */
export function readActive() {
  try {
    const raw = JSON.parse(readFileSync(activePath(), 'utf8'))
    if (raw && KEY_RE.test(String(raw.key || ''))) return { key: String(raw.key), updatedAt: Number(raw.updatedAt || 0) }
  } catch { /* 无选择文件 = 未切换过 */ }
  return null
}

/** @param {string} key */
export function writeActive(key) {
  if (!KEY_RE.test(key)) return { ok: false, error: 'invalid_key' }
  const path = activePath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify({ key, updatedAt: Date.now() }), { encoding: 'utf8', mode: 0o600 })
  return { ok: true }
}

/** 用户目录 + 包内资产合并；同名以用户目录为准。 */
export function listPersonas(cfg = {}) {
  const seen = new Map()
  for (const dir of [resolvePersonaDir(cfg), SHIPPED_DIR]) {
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.txt')) continue
        const key = f.slice(0, -4)
        if (!KEY_RE.test(key) || seen.has(key)) continue
        const st = statSync(join(dir, f))
        seen.set(key, { key, chars: st.size, mtime: st.mtimeMs })
      }
    } catch { /* 目录不存在继续 */ }
  }
  return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** @param {{ personaDir?: string, maxChars?: number }} cfg @param {string} key */
export function readPersona(cfg, key) {
  if (!KEY_RE.test(String(key || ''))) return { ok: false, error: 'invalid_key' }
  const max = Number(cfg?.maxChars || 20000)
  for (const dir of [resolvePersonaDir(cfg), SHIPPED_DIR]) {
    const path = join(dir, `${key}.txt`)
    try {
      const st = statSync(path)
      if (st.size > max) return { ok: false, error: 'persona_too_large' }
      const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
      return { ok: true, key, text, chars: text.length, mtime: st.mtimeMs }
    } catch (err) {
      if (err?.code !== 'ENOENT') return { ok: false, error: 'persona_unreadable' }
    }
  }
  return { ok: false, error: 'persona_missing' }
}
