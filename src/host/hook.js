/**
 * 人设注入：systemPrompt.section（静态资产，order=10），不是 context。
 *
 * 当前人设 = Config.dsh.defaultPersona（网页端）；QQ 端由网关按 message_type 路由，本包不注入。
 * 资产改动由 fs.watch 触发 refresh，下一次 assemble 即取新文本。
 * 读失败保留上一次成功快照（§12.4.5）；只有从未成功读过才返回空串。
 * subagent：会话元数据 origin='subagent' 时跳过（唯一真实信号是 `agents.currentInitiator()`
 * 返回的 Agent 的 session header；AssembleContext 本身不带会话信息）。
 * 生命周期：注册与缓存清理都由 ctx.effect 的 disposer 接管。
 */
import { readPersona } from './persona-store.js'
import { isEnabled } from './config-values.js'

export const SECTION_NAME = 'persona-hub:persona'
export const SECTION_ORDER = 10
const CACHE_TTL_MS = 2000

export function installPersonaHook(ctx, { config, log = () => {}, cacheTtlMs } = {}) {
  const cache = { key: '', text: '', exp: 0, mtime: 0 }
  let disposed = false
  const ttl = Number.isFinite(cacheTtlMs) && cacheTtlMs > 0 ? cacheTtlMs : CACHE_TTL_MS

  // 空 key 不回退出厂角色：resolver 对同一配置返回 null(default_persona_unset)，两端必须同口径。
  const resolveKey = () => String(config?.dsh?.defaultPersona || '')

  /** 真实信号：正在驱动的 Agent 的会话元数据 origin；拿不到就按普通会话处理。 */
  const isSubagentAssembly = () => {
    try {
      const agents = ctx?.get?.('agents')
      if (!agents || typeof agents.currentInitiator !== 'function') return false
      const agent = agents.currentInitiator()
      return agent?.session?.header?.origin === 'subagent'
    } catch {
      // 服务未就绪/已 dispose：不能阻断注入。
      return false
    }
  }

  const resolveText = () => {
    try {
      if (disposed || !isEnabled(config?.dsh?.enabled)) return ''
      if (isSubagentAssembly()) return ''
      const key = resolveKey()
      if (!key) return ''
      const now = Date.now()
      if (cache.key === key && cache.text && now < cache.exp) return cache.text
      const got = readPersona(config, key)
      if (!got.ok) {
        log(`[persona-hub] persona load fail-open: ${got.error} key=${key}`)
        // 保旧快照：读失败时续期返回上次正文，不注入空串（只有无缓存才空）。
        if (cache.key === key && cache.text) {
          cache.exp = now + ttl
          return cache.text
        }
        return ''
      }
      cache.key = key; cache.text = got.text; cache.mtime = got.mtime; cache.exp = now + ttl
      return got.text
    } catch (err) {
      log(`[persona-hub] persona inject fail-open: ${err?.message || 'error'}`)
      return ''
    }
  }

  ctx.effect(() => {
    const off = ctx.systemPrompt.section({
      name: SECTION_NAME, order: SECTION_ORDER, interpolate: false, text: resolveText,
    })
    return () => {
      disposed = true
      cache.text = ''
      cache.exp = 0
      try { off?.() } catch { /* section 已注销 */ }
    }
  }, 'persona-hub: persona section')

  return {
    refresh() { cache.exp = 0; cache.key = '' },
    resolveText,
    activeKey: resolveKey,
  }
}
