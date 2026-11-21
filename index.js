/**
 * dsh-persona-hub Host 入口（S1）。
 *
 * C = 角色资产库 + 网页端切换器：出厂三角色（bigfish/aluna/yiyi），默认 bigfish；
 * 用 systemPrompt.section(order=10) 注入当前角色；切换时给记忆包发"身份提示"
 * （role_id/workspace），不接管 QQ 端人设（那份在 Python 网关）。
 */
import { Config } from './src/host/config.js'
import { createRoutes, PREFIX, applyIdentityHint } from './src/host/routes.js'
import { installPersonaHook } from './src/host/hook.js'

export { Config }
export const inject = ['webServer', 'systemPrompt']

const log = (line) => { try { console.log(line) } catch { /* noop */ } }

export function apply(ctx, config) {
  const hook = installPersonaHook(ctx, { config, log })
  const handler = createRoutes({ config, hook, ctx })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }), 'persona-hub: routes')

  // 启动即把当前角色同步给记忆包（若已装且已就绪）；未装则等切换时再试。
  const hinted = applyIdentityHint(ctx, hook.activeKey())
  // A 若在本包之后挂载，启动瞬间取不到 service：1.5s 后重试一次（受 effect 管理，dispose 即清）。
  ctx.effect(() => {
    const timer = setTimeout(() => { applyIdentityHint(ctx, hook.activeKey()) }, 1500)
    return () => clearTimeout(timer)
  }, 'persona-hub: identity hint retry')
  log(`[persona-hub] armed persona=${hook.activeKey()} inject=${config?.injectEnabled !== false} memoryHint=${hinted}`)
}
