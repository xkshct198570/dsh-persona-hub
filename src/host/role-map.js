/**
 * 角色 → 记忆身份提示（唯一映射处）。
 *
 * 只映射 role_id；**不写 workspace**：workspace 必须由 A 按当前会话 cwd 推导
 * （两个网页工作区必须各自隔离）。旧实现在这里硬写
 * `workspace='web'`，导致云端对照组专属铁律在所有网页工作区都会被召回——
 * 角色切换只能决定"记哪个角色"，不能决定"在哪个工作区"。
 *
 * C 不写记忆库；只把提示交给 A 的可选 service（A 未装则静默跳过）。
 */
export const PERSONA_ROLE_IDS = {
  bigfish: '',
  aluna: 'aluna',
  yiyi: 'yiyi',
}

/**
 * 未知 persona 必须返回 null：调用方据此走 `clearIdentityHint()`。
 * 返回 `{roleId:''}` 会让鲸忆把 Config 里手工设的 roleId 压掉（已实测），三态必须分清：
 * `undefined`＝不改、`''`＝显式清、未知 key＝不属于人设域名。
 *
 * @param {unknown} key persona key
 * @returns {{ roleId: string } | null} 登记项返回提示；未登记返回 null
 */
export function identityForPersona(key) {
  const k = String(key ?? '')
  if (!Object.prototype.hasOwnProperty.call(PERSONA_ROLE_IDS, k)) return null
  return { roleId: PERSONA_ROLE_IDS[k] }
}
