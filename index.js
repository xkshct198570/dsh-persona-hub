/**
 * dsh-persona-hub Host 入口（S1.5：多主体人设路由中枢）。
 *
 * 三个对外面：
 *   1) systemPrompt.section(order=10)：网页端当前人设（Config.dsh.defaultPersona）。
 *   2) service `personaHub.resolvePersona({source,bot_id,chat_type,target_id})`：C 的唯一路由契约。
 *   3) 只读/配置路由：资产、配置、选择、resolve 调试。
 *
 * 边界：不写记忆库、不接管 QQ 端人设；QQ 端路由仍在 Python 网关。
 */
import { Config } from './src/host/config.js'
import { createRoutes, PREFIX, applyIdentityHint } from './src/host/routes.js'
import { installPersonaHook } from './src/host/hook.js'
import { createResolver } from './src/host/resolver.js'
import { watchPersonas, listPersonas, resolvePromptsDir, resolveMetaPath, SHIPPED_PROMPTS_DIR } from './src/host/persona-store.js'
import { writeConfigMirror } from './src/host/config-mirror.js'

export { Config }
export const inject = ['webServer', 'systemPrompt']

const log = (line) => { try { console.log(line) } catch { /* noop */ } }

export function apply(ctx, config) {
  const hook = installPersonaHook(ctx, { config, log })
  const resolver = createResolver({ config, store: { readPersona: (cfg, key) => readPersona(cfg, key) } })

  // 对外 Service：B/网关/其他插件只走这一处；C 内部实现可换。
  ctx.provide('personaHub', {
    resolvePersona: resolver,
    explainResolve: (q) => (typeof resolver.explain === 'function' ? resolver.explain(q) : { persona: null, reason: 'resolve_error', layer: 'entry' }),
    getPersona: (key) => readPersona(config, key),
    listPersonas: () => listPersonas(config),
  })

  const handler = createRoutes({ config, hook, resolver, ctx })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }), 'persona-hub: routes')

  // 资产热重载：文本/meta 一变，下一轮 assemble 即用新内容。
  if (config?.assets?.watch !== false) {
    ctx.effect(() => watchPersonas(config, () => hook.refresh()), 'persona-hub: assets watch')
  }

  // 跨进程稳定文件：Python 网关只读这里；原子写，DSH 崩了也不影响 QQ 端。
  try {
    const mirrored = writeConfigMirror(config, {
      promptsDir: resolvePromptsDir(config),
      metaFile: resolveMetaPath(config),
      fallbackPromptsDir: SHIPPED_PROMPTS_DIR,
    })
    log(`[persona-hub] config mirror -> ${mirrored}`)
  } catch (err) {
    log(`[persona-hub] config mirror failed: ${err?.message || 'error'}`)
  }

  const hinted = applyIdentityHint(ctx, hook.activeKey())
  // A 若在本包之后挂载，启动瞬间取不到 service：1.5s 后重试一次（effect 管理，dispose 即清）。
  ctx.effect(() => {
    const timer = setTimeout(() => { applyIdentityHint(ctx, hook.activeKey()) }, 1500)
    return () => clearTimeout(timer)
  }, 'persona-hub: identity hint retry')

  log(`[persona-hub] armed dsh=${hook.activeKey()} dshEnabled=${config?.dsh?.enabled !== false} bots=${Object.keys(config?.bots || {}).length} memoryHint=${hinted}`)
}
