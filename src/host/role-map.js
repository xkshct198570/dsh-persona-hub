/**
 * 角色 → 记忆身份提示（唯一映射处）。
 *
 * 口径（厂长令）：
 *   bigfish（大肥鱼，DSH 网页默认）→ workspace='web'，role_id=''
 *   aluna（阿罗娜，QQ 私聊角色）  → role_id='aluna'，workspace='web'
 *   yiyi（一叶，QQ 群角色）       → role_id='yiyi'，workspace='web'
 * C 不写记忆库、不读记忆；只把提示交给 A 的可选 service（不存在则静默跳过）。
 */
export const PERSONA_IDENTITIES = {
  bigfish: { roleId: '', workspace: 'web' },
  aluna: { roleId: 'aluna', workspace: 'web' },
  yiyi: { roleId: 'yiyi', workspace: 'web' },
}

/** @param {string} key @returns {{ roleId: string, workspace: string } | null} */
export function identityForPersona(key) {
  return PERSONA_IDENTITIES[String(key)] || null
}
