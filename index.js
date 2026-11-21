/**
 * dsh-persona-hub Host 半（S1 骨架）。
 *
 * 角色/人设是"文本资产 + 对话通道"，与记忆插件零依赖；S1 仅自证挂载。
 */
export const inject = []

/** 挂载自证。 */
export function apply(ctx) {
  ctx.effect(() => {
    console.log('[dsh-persona-hub] skeleton armed (S1)')
    return () => console.log('[dsh-persona-hub] skeleton disposed (S1)')
  }, 'persona-hub: skeleton')
}
