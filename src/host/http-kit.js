/** persona-hub 的 HTTP 小件（回环/JSON/上限）。与记忆包各自实现，避免跨包依赖。 */
import { Buffer } from 'node:buffer'

export function isLoopback(addr) {
  if (!addr) return false
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr.startsWith('127.')
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
