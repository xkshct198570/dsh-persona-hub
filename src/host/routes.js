/**
 * persona-hub 只读 + 配置路由（0.5.0）。
 *
 *   GET  /personas                 资产列表（key/name/avatar/description/chars）
 *   GET  /persona?key=             预览正文
 *   GET  /config                   dsh + bots + assets + panel
 *   POST /config                   {config:{dsh,bots,assets?,panel?}} → configEditor 保存
 *   POST /select                   {key} 设 DSH 默认角色（保存 + 身份提示）
 *   GET  /resolve                  调试：source/bot_id/chat_type/target_id → persona/reason/layer
 *   POST /reload                   清缓存（fs.watch=false 时的手工重读）
 *
 * 默认只回环（panel.allowRemote=true 才放行非回环）。写盘异常一律转 JSON，不静默失败。
 */
import { isLoopback, readJson, sendJson } from './http-kit.js'
import { dirname } from 'node:path'
import { listPersonas, readPersona, resolvePromptsDir, resolveMetaPath, SHIPPED_PROMPTS_DIR } from './persona-store.js'
import { importPersona, deletePersona, isUserPersona, checkDirWritable } from './persona-admin.js'
import { writeConfigMirror } from './config-mirror.js'
import { identityForPersona } from './role-map.js'
import { bool, value, isEnabled } from './config-values.js'

const PREFIX = '/persona-hub/api'
export const PANEL_TABS = ['personas', 'bots', 'debug']
export const KEY_RE = /^[a-z][a-z0-9_-]{0,31}$/
export const BOT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/
const POLL_MIN = 5000
const POLL_MAX = 600000
const log = (line) => { try { console.log(line) } catch { /* noop */ } }

/**
 * 切角色时给记忆中枢发身份提示（A 未装静默跳过）。
 * key 为空或网页端人设关闭时清掉旧提示，避免残留到下一个角色。
 */
export function applyIdentityHint(ctx, key, { enabled = true } = {}) {
  const svc = ctx?.get?.('whaleMemory')
  if (!svc) return false
  const k = String(key || '').trim()
  if (!enabled || !k) {
    if (typeof svc.clearIdentityHint === 'function') {
      try { svc.clearIdentityHint() } catch { /* 可选服务，异常不阻断保存 */ }
    }
    return false
  }
  if (typeof svc.setIdentityHint !== 'function') return false
  svc.setIdentityHint(identityForPersona(k))
  return true
}

/**
 * @param {{ config: any, hook: any, resolver: Function, ctx: any }} deps
 */
export function createRoutes({ config, hook, resolver, ctx }) {
  /** 保存 + 运行时对象就地更新 + 写跨进程镜像；镜像失败不否定已保存的配置。 */
  async function commitConfig(next) {
    const editor = ctx?.get?.('configEditor')
    if (!editor || typeof editor.edit !== 'function' || !ctx?.fiber?.entry) {
      return { ok: false, error: 'config_save_unavailable' }
    }
    const patch = { dsh: next.dsh, bots: next.bots }
    if (next.assets) patch.assets = next.assets
    if (next.panel) patch.panel = next.panel
    try {
      await editor.edit(ctx.fiber.entry, (current) => ({ ...(isPlainObject(current) ? current : {}), ...patch }))
    } catch (err) {
      return { ok: false, error: 'config_save_failed', detail: String(err?.message || err) }
    }
    // 面板不用等插件重挂才生效：dsh/bots/panel 即时，assets.* 的重挂语义由面板标注。
    config.dsh = next.dsh
    config.bots = next.bots
    if (next.assets) config.assets = { ...(isPlainObject(config.assets) ? config.assets : {}), ...next.assets }
    if (next.panel) config.panel = { ...(isPlainObject(config.panel) ? config.panel : {}), ...next.panel }

    let mirrorSynced = true
    try {
      writeConfigMirror(config, {
        promptsDir: resolvePromptsDir(config),
        metaFile: resolveMetaPath(config),
        fallbackPromptsDir: SHIPPED_PROMPTS_DIR,
      })
    } catch (err) {
      mirrorSynced = false
      log(`[persona-hub] config mirror failed: ${err?.message || 'error'}`)
    }
    hook?.refresh?.()
    return { ok: true, mirrorSynced }
  }

  function currentAssets() {
    const dir = String(value(config?.assets?.dir, '') || '')
    const effectiveDir = resolvePromptsDir(config)
    // 导入/删除同时写正文与 meta：两处都必须可写，面板才允许写操作。
    const promptsCheck = checkDirWritable(effectiveDir)
    const metaCheck = promptsCheck.ok === true ? checkDirWritable(dirname(resolveMetaPath(config))) : promptsCheck
    return {
      dir,
      effectiveDir,
      watch: bool(config?.assets?.watch, true),
      writable: metaCheck.ok === true,
      writeReason: metaCheck.ok === true ? '' : metaCheck.reason,
    }
  }

  function currentPanel() {
    const tab = String(value(config?.panel?.tab, 'personas'))
    const pollMs = Number(value(config?.panel?.pollMs, 60000))
    return {
      allowRemote: bool(config?.panel?.allowRemote, false),
      pollMs: Number.isFinite(pollMs) && pollMs >= POLL_MIN && pollMs <= POLL_MAX ? pollMs : 60000,
      tab: PANEL_TABS.includes(tab) ? tab : 'personas',
    }
  }

  return async function handle(req, res) {
    if (!bool(config?.panel?.allowRemote, false) && !isLoopback(req.socket?.remoteAddress)) {
      return sendJson(res, 403, { ok: false, error: 'not_loopback' })
    }
    let path = ''
    let url
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1')
      path = url.pathname
    } catch {
      url = null
      path = ''
    }

    if (path === `${PREFIX}/personas` && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        items: listPersonas(config).map((it) => ({ ...it, deletable: isUserPersona(config, it.key) })),
        dsh: {
          enabled: isEnabled(config?.dsh?.enabled),
          defaultPersona: String(config?.dsh?.defaultPersona || ''),
        },
        assets: currentAssets(),
      })
    }

    // 导入：上传纯文本（浏览器读成 string 后 JSON 提交）
    if (path === `${PREFIX}/personas/import` && req.method === 'POST') {
      const body = await readJson(req, 4 * 1024 * 1024)
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error })
      let result
      try {
        result = importPersona(config, body.value || {})
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'write_failed', detail: String(err?.message || err) })
      }
      if (!result.ok) {
        const status = result.error === 'invalid_key' || result.error === 'empty_text' ? 400
          : result.error === 'text_too_large' ? 413
            : result.error === 'write_failed' ? 500 : 409
        return sendJson(res, status, result)
      }
      hook?.refresh?.()
      return sendJson(res, 200, { ok: true, ...result })
    }

    // 删除：只删用户副本；被 DSH/bots 引用时返回 409 + usage，force=1 才强删。
    if (path.startsWith(`${PREFIX}/personas/`) && req.method === 'DELETE') {
      let key = ''
      try { key = decodeURIComponent(path.slice(`${PREFIX}/personas/`.length)) } catch { key = '' }
      // 保留名：DELETE /personas/import 是路由形状，不得当成 key 删除。
      if (!key || key === 'import') return sendJson(res, 400, { ok: false, error: 'invalid_key' })
      const force = Boolean(url && url.searchParams.get('force') === '1')
      let result
      try {
        result = deletePersona(config, key, { force, config })
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'write_failed', detail: String(err?.message || err) })
      }
      if (!result.ok) {
        const status = result.error === 'persona_in_use' || result.error === 'persona_shipped_immutable' ? 409
          : result.error === 'invalid_key' ? 400
            : result.error === 'write_failed' ? 500 : 404
        return sendJson(res, status, result)
      }
      hook?.refresh?.()
      return sendJson(res, 200, { ok: true, key: result.key })
    }

    if (path === `${PREFIX}/persona` && req.method === 'GET') {
      const key = url.searchParams.get('key') || config?.dsh?.defaultPersona || ''
      const got = readPersona(config, key)
      return got.ok
        ? sendJson(res, 200, { ok: true, key: got.key, chars: got.chars, mtime: got.mtime, meta: got.meta, text: got.text })
        : sendJson(res, 404, { ok: false, error: got.error })
    }

    if (path === `${PREFIX}/config` && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, config: {
        dsh: {
          enabled: isEnabled(config?.dsh?.enabled),
          defaultPersona: String(config?.dsh?.defaultPersona || ''),
        },
        bots: structuredCloneSafe(config?.bots || {}),
        assets: currentAssets(),
        panel: currentPanel(),
      } })
    }

    if (path === `${PREFIX}/config` && req.method === 'POST') {
      const body = await readJson(req)
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error })
      const nextCfg = body.value?.config
      if (!isPlainObject(nextCfg)) return sendJson(res, 400, { ok: false, error: 'invalid_config' })

      const dsh = normalizeDsh(nextCfg.dsh, config?.dsh)
      if (!dsh) return sendJson(res, 400, { ok: false, error: 'invalid_config' })
      if (!isPlainObject(nextCfg.bots) || !isValidBots(nextCfg.bots)) {
        return sendJson(res, 400, { ok: false, error: 'invalid_bots' })
      }

      let assets
      if (nextCfg.assets !== undefined) {
        assets = normalizeAssets(nextCfg.assets, currentAssets())
        if (!assets) return sendJson(res, 400, { ok: false, error: 'invalid_assets' })
      }
      let panel
      if (nextCfg.panel !== undefined) {
        panel = normalizePanel(nextCfg.panel, currentPanel())
        if (!panel) return sendJson(res, 400, { ok: false, error: 'invalid_panel' })
      }

      const saved = await commitConfig({ dsh, bots: nextCfg.bots, assets, panel })
      if (!saved.ok) return sendJson(res, 501, saved)
      const hinted = applyIdentityHint(ctx, dsh.defaultPersona, { enabled: dsh.enabled })
      return sendJson(res, 200, { ok: true, memoryHinted: hinted, mirrorSynced: saved.mirrorSynced })
    }

    if (path === `${PREFIX}/select` && req.method === 'POST') {
      const body = await readJson(req)
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error })
      const key = typeof body.value?.key === 'string' ? body.value.key : ''
      if (!KEY_RE.test(key)) return sendJson(res, 400, { ok: false, error: 'invalid_key' })
      const got = readPersona(config, key)
      if (!got.ok) return sendJson(res, 400, { ok: false, error: got.error })
      const nextCfg = { dsh: { ...(config?.dsh || {}), defaultPersona: key }, bots: structuredCloneSafe(config?.bots || {}) }
      const saved = await commitConfig(nextCfg)
      if (!saved.ok) return sendJson(res, 501, saved)
      const hinted = applyIdentityHint(ctx, key, { enabled: isEnabled(config?.dsh?.enabled) })
      return sendJson(res, 200, {
        ok: true, key, identityHint: identityForPersona(key), memoryHinted: hinted, mirrorSynced: saved.mirrorSynced,
      })
    }

    if (path === `${PREFIX}/resolve` && req.method === 'GET') {
      const q = {
        source: url.searchParams.get('source') || '',
        bot_id: url.searchParams.get('bot_id') || '',
        chat_type: url.searchParams.get('chat_type') || '',
        target_id: url.searchParams.get('target_id') || '',
      }
      // reason/layer 与 resolvePersona 同源（resolver.explain），面板据此显示 11 条降级原因。
      const out = typeof resolver?.explain === 'function'
        ? resolver.explain(q)
        : { persona: resolver(q), reason: 'ok', layer: '' }
      const persona = out?.persona || null
      const includeText = url.searchParams.get('include_text') === '1'
      return sendJson(res, 200, {
        ok: true,
        persona: !persona ? null : includeText ? persona : {
          personaKey: persona.personaKey, name: persona.name, avatar: persona.avatar,
        },
        reason: String(out?.reason || ''),
        layer: String(out?.layer || ''),
      })
    }

    if (path === `${PREFIX}/reload` && req.method === 'POST') {
      hook?.refresh?.()
      return sendJson(res, 200, { ok: true, reloadedAt: Date.now() })
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' })
  }
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function normalizeDsh(next, current) {
  if (!isPlainObject(next)) return null
  const enabled = next.enabled === undefined ? isEnabled(current?.enabled) : next.enabled
  if (typeof enabled !== 'boolean') return null
  const defaultPersona = next.defaultPersona === undefined
    ? String(current?.defaultPersona || '')
    : next.defaultPersona
  if (typeof defaultPersona !== 'string' || defaultPersona.length > 128) return null
  return { enabled, defaultPersona }
}

function normalizeAssets(next, current) {
  if (!isPlainObject(next)) return null
  const dir = next.dir === undefined ? String(current?.dir || '') : next.dir
  if (typeof dir !== 'string' || dir.length > 4096) return null
  const watch = next.watch === undefined ? current?.watch !== false : next.watch
  if (typeof watch !== 'boolean') return null
  return { dir: dir.trim(), watch }
}

function normalizePanel(next, current) {
  if (!isPlainObject(next)) return null
  const allowRemote = next.allowRemote === undefined ? current?.allowRemote === true : next.allowRemote
  if (typeof allowRemote !== 'boolean') return null
  const pollMs = next.pollMs === undefined ? Number(current?.pollMs) || 60000 : next.pollMs
  if (!Number.isInteger(pollMs) || pollMs < POLL_MIN || pollMs > POLL_MAX) return null
  const tab = next.tab === undefined ? String(current?.tab || 'personas') : next.tab
  if (typeof tab !== 'string' || !PANEL_TABS.includes(tab)) return null
  return { allowRemote, pollMs, tab }
}

function isValidBots(bots) {
  if (!isPlainObject(bots)) return false
  for (const [id, bot] of Object.entries(bots)) {
    if (!BOT_ID_RE.test(id)) return false
    if (!isPlainObject(bot)) return false
    if (bot.enabled !== undefined && typeof bot.enabled !== 'boolean') return false
    if (bot.platform !== undefined) {
      if (typeof bot.platform !== 'string') return false
      const platform = bot.platform.trim()
      if (!platform || platform.toLowerCase() === 'dsh') return false
    }
    for (const ch of ['private', 'group']) {
      const c = bot[ch]
      if (!isPlainObject(c)) return false
      if (c.enabled !== undefined && typeof c.enabled !== 'boolean') return false
      if (c.defaultPersona !== undefined && typeof c.defaultPersona !== 'string') return false
      if (c.bindings !== undefined) {
        if (!isPlainObject(c.bindings)) return false
        for (const [target, key] of Object.entries(c.bindings)) {
          if (!target || target.length > 128) return false
          if (typeof key !== 'string' || !KEY_RE.test(key)) return false
        }
      }
    }
  }
  return true
}

function structuredCloneSafe(value) {
  try { return structuredClone(value) } catch { return JSON.parse(JSON.stringify(value)) }
}

export { PREFIX }
