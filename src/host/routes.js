/**
 * persona-hub 只读 + 配置路由（0.5.2）。
 *
 *   GET  /personas                 资产列表（key/name/avatar/description/chars）
 *   GET  /persona?key=             预览正文
 *   GET  /config                   dsh + bots + assets + panel
 *   POST /config                   {config:{dsh,bots,assets?,panel?}} → configEditor 保存
 *   POST /select                   {key} 设 DSH 默认角色（保存 + 身份提示）
 *   GET  /resolve                  调试：source/bot_id/chat_type/target_id → persona/reason/layer
 *   POST /reload                   清缓存（fs.watch=false 时的手工重读）
 *
 * 默认只回环（panel.allowRemote=true 才放行读请求）。allowRemote 放开后非回环仍是收口读面：
 * `GET /config`（含主体绑定目标号）与 `GET /persona`（人设全文）→ 403 read_only_remote；
 * `GET /personas` 200 但走 remote-view 脱敏（无目标号、无绝对路径）；`GET /resolve` 不含正文。
 * 写请求（POST/DELETE）无论 allowRemote 如何都要求回环地址 + 本机 Host + 本机 Origin +
 * POST application/json（checkWriteGate）。写盘异常一律转 JSON，不静默失败。
 */
import { checkWriteGate, isAllowedHost, isAllowedOrigin, isLoopback, readJson, sendJson } from './http-kit.js'
import { dirname } from 'node:path'
import { listPersonas, readPersona, resolvePromptsDir, resolveMetaPath, SHIPPED_PROMPTS_DIR } from './persona-store.js'
import { importPersona, deletePersona, isUserPersona, checkDirWritable, writesShippedDir } from './persona-admin.js'
import { verifyConfigMirror, writeConfigMirror } from './config-mirror.js'
import { remotePersonasPayload } from './remote-view.js'
import { identityForPersona } from './role-map.js'
import { bool, mergePreservingVolatile, value, isEnabled } from './config-values.js'

const PREFIX = '/persona-hub/api'
export const PANEL_TABS = ['personas', 'bots', 'debug']
export const KEY_RE = /^[a-z][a-z0-9_-]{0,31}$/
export const BOT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/
const POLL_MIN = 5000
const POLL_MAX = 600000
const log = (line) => { try { console.log(line) } catch { /* noop */ } }

/**
 * 切角色时给记忆中枢发身份提示（A 未装静默跳过），返回结构化结果并落日志。
 *
 * 三态（§4.5）：
 * - 空 key / 网页端关闭 → `clearIdentityHint()`（清掉旧提示，别残留到下一个角色）；
 * - 未知 persona → 必须 `clearIdentityHint()`，**不得** `setIdentityHint({roleId:''})`
 *   ——后者会压掉鲸忆 Config 里手工设的 roleId（已实测）；
 * - 登记项（含 bigfish→''）→ `setIdentityHint({roleId})`，bigfish 保留显式置空语义。
 *
 * whaleMemory 是可选跨包服务：本包必须能独立安装；取服务、设提示、清提示三处都 fail-open，
 * 任何异常都只算"没发提示"，绝不让保存或启动失败。
 *
 * @param {any} ctx cordis 上下文
 * @param {unknown} key persona key
 * @param {{enabled?: boolean, log?: (line: string) => void}} [opts]
 * @returns {{sent: boolean, reason: 'ok'|'no_service'|'no_method'|'not_enabled'|'empty_key'|'unknown_persona'|'set_failed'|'clear_failed'}}
 */
export function applyIdentityHint(ctx, key, { enabled = true, log: logFn = log } = {}) {
  let svc
  try { svc = ctx?.get?.('whaleMemory') } catch { svc = undefined }
  if (!svc || (typeof svc !== 'object' && typeof svc !== 'function')) {
    logFn(`[persona-hub] identity hint skipped: no_service key=${String(key ?? '')}`)
    return { sent: false, reason: 'no_service' }
  }

  /** 清提示分支：reason 说明为什么没有新提示；清不掉按 no_method/clear_failed 记。 */
  const clear = (reason) => {
    if (typeof svc.clearIdentityHint !== 'function') {
      logFn(`[persona-hub] identity hint clear skipped: no_method (${reason}) key=${String(key ?? '')}`)
      return { sent: false, reason: 'no_method' }
    }
    try { svc.clearIdentityHint() } catch (err) {
      logFn(`[persona-hub] identity hint clear failed (${reason}): ${err?.message || 'error'}`)
      return { sent: false, reason: 'clear_failed' }
    }
    logFn(`[persona-hub] identity hint cleared: ${reason} key=${String(key ?? '')}`)
    return { sent: false, reason }
  }

  if (!enabled) return clear('not_enabled')
  const k = String(key ?? '').trim()
  if (!k) return clear('empty_key')
  const hint = identityForPersona(k)
  if (!hint) return clear('unknown_persona')

  if (typeof svc.setIdentityHint !== 'function') {
    logFn(`[persona-hub] identity hint skipped: no_method key=${k}`)
    return { sent: false, reason: 'no_method' }
  }
  try {
    svc.setIdentityHint(hint)
  } catch (err) {
    logFn(`[persona-hub] identity hint set failed: ${err?.message || 'error'} key=${k}`)
    return { sent: false, reason: 'set_failed' }
  }
  logFn(`[persona-hub] identity hint sent: role=${hint.roleId || '(empty)'} key=${k}`)
  return { sent: true, reason: 'ok' }
}

/**
 * @param {{ config: any, hook: any, resolver: Function, ctx: any, assetsWatcher?: any,
 *   verifyReadBack?: (config: any) => {ok: true} | {ok: false, reason: string} }} deps
 *   assetsWatcher：可重入资产 watcher（createPersonaWatcher）；commitConfig 后按当前 assets.dir 重挂。
 *   verifyReadBack：保存回读校验（缺省 verifyConfigMirror）；测试可注入抛错/不一致桩。
 */
export function createRoutes({ config, hook, resolver, ctx, assetsWatcher, verifyReadBack }) {
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
    // 面板不用等插件重挂才生效：dsh/bots 整组替换（删除语义），assets/panel 叶子合并并保 Ref。
    // 不保 Ref 会让宿主后续 volatile-only 更新静默失效（审计 P1-15）。
    config.dsh = next.dsh
    config.bots = next.bots
    if (next.assets) config.assets = mergePreservingVolatile(isPlainObject(config.assets) ? config.assets : {}, next.assets)
    if (next.panel) config.panel = mergePreservingVolatile(isPlainObject(config.panel) ? config.panel : {}, next.panel)

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
    // P2：写盘成功≠回读一致。回读失败只标记 readBackFailed（配置确实已落盘），
    // 绝不把成功报成失败；只有上面/editor 的写盘失败才 ok:false。
    let readBack = { ok: true }
    try {
      readBack = typeof verifyReadBack === 'function' ? verifyReadBack(config) : verifyConfigMirror(config)
    } catch (err) {
      readBack = { ok: false, reason: 'read_failed' }
      log(`[persona-hub] config read-back threw: ${err?.message || 'error'}`)
    }
    if (readBack?.ok !== true) log(`[persona-hub] config read-back failed: ${String(readBack?.reason || 'read_failed')}`)

    hook?.refresh?.()
    // assets.dir / assets.watch 可能刚变更：按当前配置重挂 watcher（旧目录句柄先卸掉）。
    try {
      assetsWatcher?.reload?.()
    } catch (err) {
      log(`[persona-hub] assets watcher reattach failed: ${err?.message || 'error'}`)
    }
    if (readBack?.ok !== true) {
      return { ok: true, mirrorSynced, readBackFailed: true, readBackReason: String(readBack?.reason || 'read_failed') }
    }
    return { ok: true, mirrorSynced }
  }

  function currentAssets() {
    const dir = String(value(config?.assets?.dir, '') || '')
    const effectiveDir = resolvePromptsDir(config)
    // 指向插件出厂目录（含 symlink 指向）＝只读：导入/删除会改坏随包发布的资产；
    // realpath 判定只此一处（persona-admin 导出），路由不再留会被 ReferenceError 吞掉的副本。
    if (writesShippedDir(config)) {
      return { dir, effectiveDir, watch: bool(config?.assets?.watch, true), writable: false, writeReason: 'is_shipped' }
    }
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

  /**
   * 路由总入口：单个请求的任何异常（客户端中断上传、磁盘/服务意外）都收敛成 JSON，
   * 不让 async handler 的 rejection 冒到宿主 HTTP 层。已发响应则只收尾连接。
   */
  return async function handle(req, res) {
    try {
      return await handleRequest(req, res)
    } catch (err) {
      log(`[persona-hub] route error: ${err?.message || 'error'}`)
      if (!res.headersSent && !res.writableEnded) {
        return sendJson(res, 500, { ok: false, error: 'internal_error', detail: String(err?.message || err) })
      }
      try { res.end() } catch { /* 连接已断 */ }
    }
  }

  /** allowRemote 时的绑定地址白名单；读不到绑定地址就只认回环。 */
  function boundHosts() {
    if (!bool(config?.panel?.allowRemote, false)) return []
    try {
      const host = ctx?.webServer?.host
      return typeof host === 'string' && host.trim() ? [host.trim()] : []
    } catch { return [] }
  }

  async function handleRequest(req, res) {
    const extraHosts = boundHosts()
    // Host/Origin 覆盖所有方法（含读）：DNS rebinding 页面会带外部 Host 做同源读取。
    if (!isAllowedHost(req.headers?.host, extraHosts)) {
      return sendJson(res, 403, { ok: false, error: 'bad_host' })
    }
    if (!isAllowedOrigin(req.headers?.origin, extraHosts)) {
      return sendJson(res, 403, { ok: false, error: 'cross_origin' })
    }
    if (!bool(config?.panel?.allowRemote, false) && !isLoopback(req.socket?.remoteAddress)) {
      return sendJson(res, 403, { ok: false, error: 'not_loopback' })
    }
    const remote = !isLoopback(req.socket?.remoteAddress)
    let path = ''
    let url
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1')
      path = url.pathname
    } catch {
      url = null
      path = ''
    }

    // 远端读面收口：allowRemote 只放开"角色列表"这一层；配置（主体绑定目标号）与人设正文
    // 属于本机面板能力，远端一律 403。回环不受影响。
    if (remote && req.method === 'GET' && (path === `${PREFIX}/config` || path === `${PREFIX}/persona`)) {
      log(`[persona-hub] remote read denied: read_only_remote ${path}`)
      return sendJson(res, 403, { ok: false, error: 'read_only_remote' })
    }

    // 写闸（§4.5）：所有 POST/DELETE 在任何业务动作之前统一校验——回环地址、Host 本机、
    // Origin 白名单、POST 必须 application/json。只判回环不构成 CSRF 防护，四者缺一不可。
    if ((req.method === 'POST' || req.method === 'DELETE') && path.startsWith(`${PREFIX}/`)) {
      const denied = checkWriteGate(req)
      if (denied) {
        log(`[persona-hub] write rejected: ${denied.error} ${req.method} ${path}`)
        return sendJson(res, denied.status, { ok: false, error: denied.error })
      }
    }

    if (path === `${PREFIX}/personas` && req.method === 'GET') {
      const items = listPersonas(config).map((it) => ({ ...it, deletable: isUserPersona(config, it.key) }))
      const dsh = {
        enabled: isEnabled(config?.dsh?.enabled),
        defaultPersona: String(config?.dsh?.defaultPersona || ''),
      }
      if (remote) {
        return sendJson(res, 200, remotePersonasPayload({
          bots: config?.bots || {},
          items,
          assets: currentAssets(),
          dsh,
        }))
      }
      return sendJson(res, 200, { ok: true, items, dsh, assets: currentAssets() })
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
        const status = result.error === 'persona_in_use' || result.error === 'persona_shipped_immutable'
          || result.error === 'assets_dir_shipped' ? 409
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

      const dsh = normalizeDsh(nextCfg.dsh, config?.dsh, config)
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
      const hint = applyIdentityHint(ctx, dsh.defaultPersona, { enabled: dsh.enabled })
      return sendJson(res, 200, {
        ok: true,
        memoryHinted: hint.sent,
        memoryHint: hint,
        mirrorSynced: saved.mirrorSynced,
        // 写盘成功但回读不一致：ok 仍为 true，另带短码，面板据此提示「已保存·回读失败」。
        ...(saved.readBackFailed ? { readBackFailed: true, readBackReason: saved.readBackReason } : {}),
      })
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
      const hint = applyIdentityHint(ctx, key, { enabled: isEnabled(config?.dsh?.enabled) })
      return sendJson(res, 200, {
        ok: true,
        key,
        identityHint: identityForPersona(key),
        memoryHinted: hint.sent,
        memoryHint: hint,
        mirrorSynced: saved.mirrorSynced,
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
      // /persona 已对远端 403；resolve 的 include_text 也必须同样收口，否则远端能从调试口读到正文。
      const includeText = !remote && url.searchParams.get('include_text') === '1'
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

function normalizeDsh(next, current, cfg) {
  if (!isPlainObject(next)) return null
  const enabled = next.enabled === undefined ? isEnabled(current?.enabled) : next.enabled
  if (typeof enabled !== 'boolean') return null
  const defaultPersona = next.defaultPersona === undefined
    ? String(current?.defaultPersona || '')
    : next.defaultPersona
  if (typeof defaultPersona !== 'string' || Array.from(defaultPersona).length > 128) return null
  // 空＝该层未设（resolver 返回 default_persona_unset）；非空必须与 /select 同一条 key 规则，
  // 否则能存进一个永远读不到资产的死配置。
  if (defaultPersona) {
    if (!KEY_RE.test(defaultPersona)) return null
    // 资产必须真实可读：读不到的死 key 不许落库（面板标红之外，保存入口自己先拒）。
    if (!readPersona(cfg, defaultPersona).ok) {
      log(`[persona-hub] config rejected: dsh.defaultPersona asset missing key=${defaultPersona}`)
      return null
    }
  }
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
      if (c.defaultPersona && !KEY_RE.test(c.defaultPersona)) return false
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
