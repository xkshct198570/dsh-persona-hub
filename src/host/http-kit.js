/** persona-hub 的 HTTP 小件（回环/JSON/上限/写闸）。与记忆包各自实现，避免跨包依赖。 */
import { Buffer } from 'node:buffer'

/** 本机回环主机名（HTTP Host / Origin 白名单）。IPv6 在 URL 里带方括号，两种写法都收。 */
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const LOCAL_SCHEMES = new Set(['http:', 'https:'])

export function isLoopback(addr) {
  if (!addr) return false
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr.startsWith('127.')
}

function headerString(req, name) {
  const raw = req?.headers?.[name]
  return Array.isArray(raw) ? raw[0] : raw
}

function isLocalHostname(hostname) {
  return LOCAL_HOSTNAMES.has(String(hostname || '').toLowerCase())
}

/** 绑定地址字面量归一（IPv6 去括号/小写）。 */
function normalizeBindHost(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  if (raw.startsWith('[') && raw.endsWith(']')) return raw.slice(1, -1)
  return raw
}

/**
 * Host 白名单：本机名恒放行；allowRemote 时额外放行 webServer 实际绑定地址。
 * 读请求也必须过这一关——旧实现只有写闸校验 Host，读接口可被 DNS rebinding 页面
 * 以同源方式读走全部人设正文/配置（实测 Host: evil.example 返回 200）。
 *
 * @param {unknown} host Host 头原值
 * @param {string[]} [boundHosts]
 * @returns {boolean}
 */
export function isAllowedHost(host, boundHosts = []) {
  const raw = String(host ?? '').trim()
  if (!raw) return true
  let url
  try { url = new URL(`http://${raw}`) } catch { return false }
  const name = String(url.hostname).toLowerCase().replace(/^\[|\]$/g, '')
  if (isLocalHostname(name)) return true
  return boundHosts.map(normalizeBindHost).filter(Boolean).includes(name)
}

/**
 * Origin 白名单（allowRemote 版）：本机源 + 绑定地址源；带 userinfo/其他 scheme 一律拒绝。
 * @param {unknown} origin @param {string[]} [boundHosts]
 * @returns {boolean}
 */
export function isAllowedOrigin(origin, boundHosts = []) {
  const raw = String(origin ?? '').trim()
  if (!raw) return true
  let url
  try { url = new URL(raw) } catch { return false }
  if (!LOCAL_SCHEMES.has(url.protocol)) return false
  if (url.username || url.password) return false
  const name = String(url.hostname).toLowerCase().replace(/^\[|\]$/g, '')
  if (isLocalHostname(name)) return true
  return boundHosts.map(normalizeBindHost).filter(Boolean).includes(name)
}

/**
 * Origin 白名单：空 Origin 放行（curl/同机非浏览器）；否则必须是本机 http(s) 源。
 * 带 userinfo、其他 scheme、畸形串一律拒绝——CSRF 页面会带真实 Origin，不能只靠回环地址。
 * @param {unknown} origin Origin 头原值
 * @returns {boolean}
 */
export function isLocalOrigin(origin) {
  const raw = String(origin ?? '').trim()
  if (!raw) return true
  let url
  try { url = new URL(raw) } catch { return false }
  if (!LOCAL_SCHEMES.has(url.protocol)) return false
  if (url.username || url.password) return false
  return isLocalHostname(url.hostname)
}

/**
 * Host 头校验（防 DNS rebinding）：缺省/空串放行（curl 历史行为），
 * 非空则必须解析成本机主机名；`[evil`、`[]`、`:8080` 等畸形串直接拒绝。
 * @param {unknown} host Host 头原值
 * @returns {boolean}
 */
export function isLocalHostHeader(host) {
  const raw = String(host ?? '').trim()
  if (!raw) return true
  let url
  try { url = new URL(`http://${raw}`) } catch { return false }
  return isLocalHostname(url.hostname)
}

/** 写方法的 Content-Type 必须是 JSON（接受 application/json 与 +json 后缀）。 */
export function isJsonContentType(req) {
  const media = String(headerString(req, 'content-type') ?? '').split(';')[0].trim().toLowerCase()
  return media === 'application/json' || media.endsWith('+json')
}

/**
 * persona 写入口三合一闸（所有 POST/DELETE 业务前调用）：
 * 回环地址 + Host 本机 + Origin 白名单 + POST 必须 application/json。
 * DELETE 允许无 body/无 Content-Type（浏览器 DELETE 不带简单请求体），但仍查 Host/Origin。
 * @param {{method?:string,headers?:Record<string,unknown>,socket?:{remoteAddress?:string}}} req
 * @returns {null | {status:number,error:'not_loopback'|'bad_host'|'cross_origin'|'unsupported_media_type'}}
 */
export function checkWriteGate(req) {
  if (!isLoopback(req?.socket?.remoteAddress)) return { status: 403, error: 'not_loopback' }
  if (!isLocalHostHeader(headerString(req, 'host'))) return { status: 403, error: 'bad_host' }
  if (!isLocalOrigin(headerString(req, 'origin'))) return { status: 403, error: 'cross_origin' }
  if (req?.method !== 'DELETE' && !isJsonContentType(req)) return { status: 415, error: 'unsupported_media_type' }
  return null
}

export function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

export async function readJson(req, maxBytes = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) return { ok: false, status: 413, error: 'payload_too_large' }
    chunks.push(chunk)
  }
  if (!size) return { ok: false, status: 400, error: 'invalid_json' }
  try { return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) } }
  catch { return { ok: false, status: 400, error: 'invalid_json' } }
}
