/**
 * 角色 → 记忆身份提示（唯一映射处）。
 *
 * 已知三角色给精确分区；自定义角色在网页端一律 workspace='web'、role_id=''（共享+网页）。
 * C 不写记忆库；只把提示交给 A 的可选 service。
 */
export const PERSONA_IDENTITIES = {
  bigfish: { roleId: '', workspace: 'web' },
  aluna: { roleId: 'aluna', workspace: 'web' },
  yiyi: { roleId: 'yiyi', workspace: 'web' },
}

/** @param {string} key */
export function identityForPersona(key) {
  return PERSONA_IDENTITIES[String(key)] || { roleId: '', workspace: 'web' }
}
