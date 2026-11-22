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
