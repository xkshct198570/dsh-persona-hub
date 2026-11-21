/**
 * 只读 + 选择路由：
 *   GET  /persona-hub/api/personas  角色资产列表
 *   GET  /persona-hub/api/persona?key=  预览
 *   GET  /persona-hub/api/active    当前网页默认角色
 *   POST /persona-hub/api/select    切换默认角色（写 active.json + 通知记忆包身份提示）
 * 默认只回环。
 */
import { isLoopback, readJson, sendJson } from './http-kit.js'
import { listPersonas, readPersona, readActive, writeActive } from './persona-store.js'
import { identityForPersona } from './role-map.js'

const PREFIX = '/persona-hub/api'

/** 把角色映射成身份提示交给记忆包（未装记忆包则静默跳过）。 */
export function applyIdentityHint(ctx, key) {
  const hint = identityForPersona(key)
  if (!hint) return false
  const svc = ctx?.get?.('whaleMemory')
  if (!svc || typeof svc.setIdentityHint !== 'function') return false
  svc.setIdentityHint(hint)
  return true
}

export function createRoutes({ config, hook, ctx }) {
  return async function handle(req, res) {
    if (!config?.panel?.allowRemote && !isLoopback(req.socket?.remoteAddress)) {
      return sendJson(res, 403, { ok: false, error: 'not_loopback' })
    }
    let path = ''
    try { path = new URL(req.url || '/', 'http://127.0.0.1').pathname } catch { path = '' }
    const url = new URL(req.url || '/', 'http://127.0.0.1')

    if (path === `${PREFIX}/personas` && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, items: listPersonas(config), active: hook?.activeKey?.() || config?.defaultPersona })
    }
    if (path === `${PREFIX}/persona` && req.method === 'GET') {
      const key = url.searchParams.get('key') || config?.defaultPersona || 'bigfish'
      const got = readPersona(config, key)
      return got.ok
        ? sendJson(res, 200, { ok: true, key: got.key, chars: got.chars, mtime: got.mtime, text: got.text })
        : sendJson(res, 404, { ok: false, error: got.error })
    }
    if (path === `${PREFIX}/active` && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, key: hook?.activeKey?.() || config?.defaultPersona || 'bigfish', identityHint: identityForPersona(hook?.activeKey?.() || config?.defaultPersona) })
    }
    if (path === `${PREFIX}/select` && req.method === 'POST') {
      const body = await readJson(req)
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error })
      const key = typeof body.value?.key === 'string' ? body.value.key : ''
      const got = readPersona(config, key)
      if (!got.ok) return sendJson(res, 400, { ok: false, error: got.error })
      const wrote = writeActive(key)
      if (!wrote.ok) return sendJson(res, 400, { ok: false, error: wrote.error })
      hook?.refresh?.()
      const hinted = applyIdentityHint(ctx, key)
      return sendJson(res, 200, { ok: true, key, identityHint: identityForPersona(key), memoryHinted: hinted })
    }
    if (path === `${PREFIX}/reload` && req.method === 'POST') {
      hook?.refresh?.()
      return sendJson(res, 200, { ok: true })
    }
    if (path === `${PREFIX}/config` && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, config: {
        defaultPersona: config?.defaultPersona, injectEnabled: config?.injectEnabled,
        personaDir: config?.personaDir || '',
      } })
    }
    return sendJson(res, 404, { ok: false, error: 'not_found' })
  }
}

export { PREFIX }
