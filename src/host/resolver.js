/**
 * resolvePersona：唯一的路由函数（C 包对外契约）。
 *
 *   source='dsh'  → dsh.enabled ? dsh.defaultPersona : null
 *   source=其他    → bots[bot_id]（enabled + platform 匹配）→ chat_type 通道（enabled）
 *                    → bindings[target_id] → 通道 defaultPersona → 读资产
 *   任一层关闭/缺键/资产缺失 → null（调用方兜底，绝不抛）
 *
 * 返回 { personaKey, name, avatar, text }；meta 缺失时 name=personaKey、avatar=''。
 * `resolver.explain(q)` 返回 { persona, reason, layer }，供面板/网关诊断；与 resolve 同一判定。
 */

/**
 * @param {{ config: any, store: { readPersona: (cfg:any, key:string) => any } }} deps
 */
export function createResolver({ config, store }) {
  function decide(q = {}) {
    try {
      const source = String(q.source || '')
      if (!source) return miss('source_missing', 'entry')

      if (source === 'dsh') {
        if (!config?.dsh?.enabled) return miss('dsh_disabled', 'dsh')
        const key = String(config?.dsh?.defaultPersona || '')
        if (!key) return miss('default_persona_unset', 'dsh')
        const persona = pick(key)
        return persona ? { persona, reason: 'ok', layer: 'dsh' } : miss('persona_asset_missing', 'asset')
      }

      const botId = String(q.bot_id || '')
      if (!botId) return miss('bot_id_required', 'bot')
      const bot = config?.bots?.[botId]
      if (!bot) return miss('bot_unknown', 'bot')
      if (!bot.enabled) return miss('bot_disabled', 'bot')
      const platform = String(bot.platform || '')
      if (platform && platform !== source) return miss('platform_mismatch', 'bot')

      const chatType = String(q.chat_type || '')
      if (chatType !== 'private' && chatType !== 'group') return miss('chat_type_invalid', 'entry')
      const channel = chatType === 'group' ? bot.group : bot.private
      if (!channel || !channel.enabled) return miss('chat_type_disabled', 'channel')

      const target = String(q.target_id || '')
      const bound = target ? channel.bindings?.[target] : undefined
      if (bound) {
        const persona = pick(bound)
        return persona ? { persona, reason: 'ok', layer: 'binding' } : miss('persona_asset_missing', 'asset')
      }
      const fallbackKey = String(channel.defaultPersona || '')
      if (!fallbackKey) return miss('default_persona_unset', 'channel')
      const persona = pick(fallbackKey)
      return persona ? { persona, reason: 'ok', layer: 'bot-default' } : miss('persona_asset_missing', 'asset')
    } catch {
      return miss('resolve_error', 'entry')
    }
  }

  function pick(key) {
    const k = String(key || '').trim()
    if (!k) return null
    const got = store.readPersona(config, k)
    if (!got || got.ok !== true) return null
    return {
      personaKey: k,
      name: String(got.meta?.name || k),
      avatar: String(got.meta?.avatar || ''),
      text: String(got.text || ''),
    }
  }

  function miss(reason, layer) { return { persona: null, reason, layer } }

  /** @type {((q:any)=>{personaKey:string,name:string,avatar:string,text:string}|null) & { explain?: Function }} */
  const resolvePersona = (q) => decide(q).persona
  resolvePersona.explain = (q) => decide(q)
  return resolvePersona
}
