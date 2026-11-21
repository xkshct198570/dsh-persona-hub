/**
 * persona-hub 只读 + 配置路由（S1.5）。
 *
 *   GET  /personas                 资产列表（key/name/avatar/chars）
 *   GET  /persona?key=             预览正文
 *   GET  /config                   dsh + bots 配置
 *   POST /config                   {config:{dsh,bots}} → configEditor 保存
 *   POST /select                   {key} 设 DSH 默认角色（保存 + 身份提示）
 *   GET  /resolve                  调试：source/bot_id/chat_type/target_id → persona
 *   POST /reload                   清缓存（fs.watch 之外的兜底）
 * 默认只回环。
 */
import { isLoopback, readJson, sendJson } from './http-kit.js'
import { listPersonas, readPersona, resolvePromptsDir, resolveMetaPath, SHIPPED_PROMPTS_DIR } from './persona-store.js'
import { writeConfigMirror } from './config-mirror.js'
import { identityForPersona } from './role-map.js'
import { bool, value } from './config-values.js'

const PREFIX = '/persona-hub/api'

export function applyIdentityHint(ctx, key) {
  const hint = identityForPersona(key)
  if (!hint) return false
  const svc = ctx?.get?.('whaleMemory')
  if (!svc || typeof svc.setIdentityHint !== 'function') return false
  svc.setIdentityHint(hint)
  return true
}

/**
 * @param {{ config: any, hook: any, resolver: Function, ctx: any }} deps
 */
export function createRoutes({ config, hook, resolver, ctx }) {
  async function saveConfig(next) {
    try {
      const editor = ctx?.get?.('configEditor')
      if (!editor || typeof editor.edit !== 'function' || !ctx?.fiber?.entry) {
        return { ok: false, error: 'config_save_unavailable' }
      }
      await editor.edit(ctx.fiber.entry, (current) => ({
        ...(current || {}),
        dsh: next.dsh,
        bots: next.bots,
      }))
      writeConfigMirror({ dsh: next.dsh, bots: next.bots }, {
        promptsDir: resolvePromptsDir(config),
        metaFile: resolveMetaPath(config),
        fallbackPromptsDir: SHIPPED_PROMPTS_DIR,
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: 'config_save_failed', detail: String(err?.message || err) }
    }
  }

  return async function handle(req, res) {
    if (!bool(config?.panel?.allowRemote, false) && !isLoopback(req.socket?.remoteAddress)) {
      return sendJson(res, 403, { ok: false, error: 'not_loopback' })
    }
    let path = ''
    try { path = new URL(req.url || '/', 'http://127.0.0.1').pathname } catch { path = '' }
    const url = new URL(req.url || '/', 'http://127.0.0.1')

    if (path === `${PREFIX}/personas` && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        items: listPersonas(config),
        dsh: { enabled: config?.dsh?.enabled !== false, defaultPersona: config?.dsh?.defaultPersona || '' },
      })
    }

    if (path === `${PREFIX}/persona` && req.method === 'GET') {
      const key = url.searchParams.get('key') || config?.dsh?.defaultPersona || 'bigfish'
      const got = readPersona(config, key)
      return got.ok
        ? sendJson(res, 200, { ok: true, key: got.key, chars: got.chars, mtime: got.mtime, meta: got.meta, text: got.text })
        : sendJson(res, 404, { ok: false, error: got.error })
    }

    if (path === `${PREFIX}/config` && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, config: {
        dsh: { ...(config?.dsh || {}) },
        bots: structuredCloneSafe(config?.bots || {}),
        assets: { dir: value(config?.assets?.dir, ''), watch: bool(config?.assets?.watch, true) },
      } })
    }

    if (path === `${PREFIX}/config` && req.method === 'POST') {
      const body = await readJson(req)
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error })
      const nextCfg = body.value?.config
      if (!nextCfg || typeof nextCfg !== 'object' || !nextCfg.dsh || typeof nextCfg.bots !== 'object') {
        return sendJson(res, 400, { ok: false, error: 'invalid_config' })
      }
      if (!isValidBots(nextCfg.bots)) return sendJson(res, 400, { ok: false, error: 'invalid_bots' })
      const saved = await saveConfig(nextCfg)
      if (!saved.ok) return sendJson(res, 501, saved)
      // 当前运行时对象就地更新，避免等插件重挂才生效
      config.dsh = nextCfg.dsh
      config.bots = nextCfg.bots
      hook?.refresh?.()
      const hinted = applyIdentityHint(ctx, config?.dsh?.defaultPersona || '')
      return sendJson(res, 200, { ok: true, memoryHinted: hinted })
    }

    if (path === `${PREFIX}/select` && req.method === 'POST') {
      const body = await readJson(req)
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error })
      const key = typeof body.value?.key === 'string' ? body.value.key : ''
      const got = readPersona(config, key)
      if (!got.ok) return sendJson(res, 400, { ok: false, error: got.error })
      const nextCfg = { dsh: { ...(config?.dsh || {}), defaultPersona: key }, bots: structuredCloneSafe(config?.bots || {}) }
      const saved = await saveConfig(nextCfg)
      if (!saved.ok) return sendJson(res, 501, saved)
      config.dsh = nextCfg.dsh
      hook?.refresh?.()
      const hinted = applyIdentityHint(ctx, key)
      return sendJson(res, 200, { ok: true, key, identityHint: identityForPersona(key), memoryHinted: hinted })
    }

    if (path === `${PREFIX}/resolve` && req.method === 'GET') {
      const q = {
        source: url.searchParams.get('source') || '',
        bot_id: url.searchParams.get('bot_id') || '',
        chat_type: url.searchParams.get('chat_type') || '',
        target_id: url.searchParams.get('target_id') || '',
      }
      const persona = resolver(q)
      if (!persona) return sendJson(res, 200, { ok: true, persona: null })
      const includeText = url.searchParams.get('include_text') === '1'
      return sendJson(res, 200, { ok: true, persona: includeText ? persona : {
        personaKey: persona.personaKey, name: persona.name, avatar: persona.avatar,
      } })
    }

    if (path === `${PREFIX}/reload` && req.method === 'POST') {
      hook?.refresh?.()
      return sendJson(res, 200, { ok: true })
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' })
  }
}

function isValidBots(bots) {
  for (const [id, bot] of Object.entries(bots)) {
    if (!id || id.length > 128) return false
    if (!bot || typeof bot !== 'object') return false
    for (const ch of ['private', 'group']) {
      const c = bot[ch]
      if (!c || typeof c !== 'object') return false
      if (c.bindings !== undefined && (typeof c.bindings !== 'object' || Array.isArray(c.bindings))) return false
    }
  }
  return true
}

function structuredCloneSafe(value) {
  try { return structuredClone(value) } catch { return JSON.parse(JSON.stringify(value)) }
}

export { PREFIX }
