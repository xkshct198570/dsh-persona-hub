/**
 * 人设注入：systemPrompt.section（静态资产，order=10），不是 context。
 *
 * 当前人设 = Config.dsh.defaultPersona（网页端）；QQ 端由网关按 message_type 路由，本包不注入。
 * 资产改动由 fs.watch 触发 refresh，下一次 assemble 即取新文本。
 * 生命周期：注册包在 ctx.effect；dispose 后返回空串。
 */
import { readPersona } from './persona-store.js'

export const SECTION_NAME = 'persona-hub:persona'
export const SECTION_ORDER = 10
const CACHE_TTL_MS = 2000

export function installPersonaHook(ctx, { config, log = () => {} }) {
  const cache = { key: '', text: '', exp: 0, mtime: 0 }
  let disposed = false

  const resolveKey = () => String(config?.dsh?.defaultPersona || 'bigfish')

  const resolveText = (context) => {
    try {
      if (disposed || config?.dsh?.enabled === false) return ''
      const origin = context?.agent?.session?.header?.origin
        ?? context?.scope?.session?.header?.origin
      if (origin === 'subagent') return ''
      const key = resolveKey()
      const now = Date.now()
      if (cache.key === key && cache.text && now < cache.exp) return cache.text
      const got = readPersona(config, key)
      if (!got.ok) { log(`[persona-hub] persona load fail-open: ${got.error} key=${key}`); return '' }
      cache.key = key; cache.text = got.text; cache.mtime = got.mtime; cache.exp = now + CACHE_TTL_MS
      return got.text
    } catch (err) {
      log(`[persona-hub] persona inject fail-open: ${err?.message || 'error'}`)
      return ''
    }
  }

  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION_NAME, order: SECTION_ORDER, interpolate: false, text: resolveText,
  }), 'persona-hub: persona section')

  return {
    dispose() { disposed = true; cache.text = ''; cache.exp = 0 },
    refresh() { cache.exp = 0; cache.key = '' },
    resolveText,
    activeKey: resolveKey,
  }
}
