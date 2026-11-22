/**
 * 角色 → 记忆身份提示（唯一映射处）。
 *
 * 只映射 role_id；**不写 workspace**：workspace 必须由 A 按当前会话 cwd 推导
 * （`/home/hy/hy` 与 `/home/hy/网页端聊天` 是两个工作区）。旧实现在这里硬写
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

/** @param {string} key @returns {{ roleId: string }} */
export function identityForPersona(key) {
  const roleId = Object.prototype.hasOwnProperty.call(PERSONA_ROLE_IDS, String(key))
    ? PERSONA_ROLE_IDS[String(key)]
    : ''
  return { roleId }
}
