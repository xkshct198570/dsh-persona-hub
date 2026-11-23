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
import { isEnabled } from './src/host/config-values.js'
import { readPersona, createPersonaWatcher, listPersonas, resolvePromptsDir, resolveMetaPath, SHIPPED_PROMPTS_DIR } from './src/host/persona-store.js'
import { writeConfigMirror } from './src/host/config-mirror.js'

export { Config }
export const inject = ['webServer', 'systemPrompt']

const log = (line) => { try { console.log(line) } catch { /* noop */ } }

export function apply(ctx, config) {
  // 启动瞬间 A（鲸忆）可能还没挂载：先试一次。失败时由 hook 首次 assemble 幂等补发一次。
  let initialHintSent = false
  const hook = installPersonaHook(ctx, {
    config,
    log,
    onFirstAssemble() {
      if (initialHintSent) return
      const hint = applyIdentityHint(ctx, hook.activeKey(), { enabled: isEnabled(config?.dsh?.enabled) })
      log(`[persona-hub] identity hint bootstrap: sent=${hint.sent} reason=${hint.reason}`)
    },
  })
  const resolver = createResolver({ config, store: { readPersona: (cfg, key) => readPersona(cfg, key) } })

  // 对外 Service：B/网关/其他插件只走这一处；C 内部实现可换。
  ctx.provide('personaHub', {
    version: '0.5.0',
    resolvePersona: resolver,
    explainResolve: (q) => (typeof resolver.explain === 'function' ? resolver.explain(q) : { persona: null, reason: 'resolve_error', layer: 'entry' }),
    getPersona: (key) => readPersona(config, key),
    listPersonas: () => listPersonas(config),
  })

  // 资产热重载：可重入 watcher。POST /config 改 assets.dir/watch 后由 commitConfig 重挂。
  const assetsWatcher = createPersonaWatcher(config, () => hook.refresh())
  ctx.effect(() => {
    assetsWatcher.reload()
    return () => assetsWatcher.dispose()
  }, 'persona-hub: assets watch')

  const handler = createRoutes({ config, hook, resolver, ctx, assetsWatcher })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }), 'persona-hub: routes')

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

  const initialHint = applyIdentityHint(ctx, hook.activeKey(), { enabled: isEnabled(config?.dsh?.enabled) })
  initialHintSent = initialHint.sent
  log(`[persona-hub] armed dsh=${hook.activeKey()} dshEnabled=${isEnabled(config?.dsh?.enabled)} bots=${Object.keys(config?.bots || {}).length} memoryHint=${initialHint.sent}/${initialHint.reason}`)
}
