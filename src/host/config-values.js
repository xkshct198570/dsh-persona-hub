/** `.volatile()` 字段是 Ref：统一 `.get()`，禁止直接用对象真假判断开关。 */
export function value(v, fallback) {
  const raw = v && typeof v.get === 'function' ? v.get() : v
  return raw === undefined ? fallback : raw
}
export function bool(v, fallback = false) {
  const raw = value(v, fallback)
  return typeof raw === 'boolean' ? raw : fallback
}
