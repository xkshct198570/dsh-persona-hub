/** `.volatile()` 字段是 Ref：统一 `.get()`，禁止直接用对象真假判断开关。 */

export function value(v, fallback) {
  const raw = v && typeof v.get === 'function' ? v.get() : v
  return raw === undefined ? fallback : raw
}

export function bool(v, fallback = false) {
  const raw = value(v, fallback)
  return typeof raw === 'boolean' ? raw : fallback
}

/**
 * 开关语义（与 Python `persona_reader` 的 `enabled is False` 对齐）：
 * 只有显式 false / 0 / 空串才算关闭；字段缺失（undefined）＝开启。
 * 镜像文件/手工编辑可能缺字段，不能把"缺省"当"关闭"。
 */
export function isEnabled(v, fallback = true) {
  const raw = value(v, fallback)
  return !(raw === false || raw === 0 || raw === '')
}

/**
 * cosmokit Volatile 写协议（与宿主 `updateVolatile` 同一符号）。
 *
 * 保存配置时若把 Ref 整个换成普通值，宿主后续"只改 volatile 字段"的更新找不到 Ref，
 * 会静默失效到重启（审计 P1-15）；回写运行态必须保住原引用。
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** @param {unknown} v @returns {boolean} */
export function isVolatileRef(v) {
  return Boolean(v) && typeof v === 'object' && VOLATILE_WRITE in /** @type {object} */ (v)
}

function writeRef(ref, next) {
  try {
    const current = typeof ref.get === 'function' ? ref.get() : undefined
    if (JSON.stringify(current) === JSON.stringify(next)) return
  } catch { /* 比较失败照常写 */ }
  ref[VOLATILE_WRITE](next)
}

/**
 * 叶子合并并保留既有 Ref（用于 assets/panel 这类含 volatile 字段的组）。
 * @param {any} target @param {any} patch @returns {any}
 */
export function mergePreservingVolatile(target, patch) {
  // 整组是 Ref 时只能写值，不能展开（否则写冻结对象会抛 object is not extensible）。
  if (isVolatileRef(target)) { writeRef(target, patch); return target }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const base = target && typeof target === 'object' && !Array.isArray(target) ? target : {}
  for (const [key, next] of Object.entries(patch)) {
    if (next === undefined) continue
    const current = base[key]
    if (isVolatileRef(current)) { writeRef(current, next); continue }
    if (next && typeof next === 'object' && !Array.isArray(next)) {
      base[key] = current && typeof current === 'object' && !Array.isArray(current)
        ? mergePreservingVolatile(current, next)
        : mergePreservingVolatile({}, next)
      continue
    }
    base[key] = Array.isArray(next) ? next.slice() : next
  }
  return base
}
