/**
 * 写路由三合一闸 + symlink 出厂目录 + 死 key 拒存（R9-08）。
 *
 * 锁住：
 *   - POST /config 等写方法必须 application/json（text/plain 简单请求 415，防本机网页 CSRF）；
 *   - 跨源 Origin、带 userinfo、非 http(s) scheme 一律 403；空 Origin 放行（同机脚本）；
 *   - Host 非本机/畸形串 403（DNS rebinding），DELETE 无 body 也必须过 Host/Origin 闸；
 *   - assets.dir 用 symlink 指向出厂目录 → writable=false（is_shipped），导入被 409 拒；
 *   - POST /config 的非空 dsh.defaultPersona 必须资产真实可读，否则 400 invalid_config。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createRoutes } from '../src/host/routes.js'
import { createResolver } from '../src/host/resolver.js'
import { readPersona, SHIPPED_PROMPTS_DIR } from '../src/host/persona-store.js'
import { checkWriteGate } from '../src/host/http-kit.js'

let server, base, home, oldHome
const hinted = []
const cleared = []
const saved = []
const memService = { setIdentityHint(h) { hinted.push(h) }, clearIdentityHint() { cleared.push(true) } }
const editor = { async edit(entry, fn) { saved.push(fn({ dsh: { enabled: true, defaultPersona: 'bigfish' }, bots: {} })); return {} } }
const hook = { refresh() {} }
const config = { dsh: { enabled: true, defaultPersona: 'bigfish' }, bots: {}, assets: { dir: '', watch: false }, panel: { allowRemote: false } }
const ctx = {
  fiber: { entry: {} },
  get(name) {
    if (name === 'whaleMemory') return memService
    if (name === 'configEditor') return editor
    return undefined
  },
}

before(async () => {
  home = mkdtempSync(join(tmpdir(), 'persona-gate-'))
  oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  mkdirSync(join(home, 'persona-hub', 'prompts'), { recursive: true })
  writeFileSync(join(home, 'persona-hub', 'prompts', 'aluna.txt'), '阿罗娜正文', 'utf8')
  const resolver = createResolver({ config, store: { readPersona } })
  server = http.createServer(createRoutes({ config, hook, resolver, ctx }))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise((r) => server.close(r))
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  rmSync(home, { recursive: true, force: true })
})

/** 原生 http 请求：fetch 不允许伪造 Host，DNS rebinding 用例必须走这里。 */
function rawRequest(path, { method = 'POST', headers = {}, body = '{}' } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(base)
    const req = http.request({
      host: url.hostname, port: url.port, path, method, headers,
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: text }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

test('写闸：POST text/plain（跨源简单请求）→ 415 且不触业务', async () => {
  const res = await fetch(base + '/persona-hub/api/config', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin: 'http://127.0.0.1:3080' },
    body: JSON.stringify({ config: { dsh: { enabled: true, defaultPersona: 'bigfish' }, bots: {} } }),
  })
  assert.equal(res.status, 415)
  const body = await res.json()
  assert.equal(body.error, 'unsupported_media_type')
  assert.equal(saved.length, 0, '415 必须发生在读 body/写配置之前')
})

test('写闸：跨源 Origin / userinfo / 非 http(s) → 403 cross_origin', async () => {
  const bad = [
    'http://evil.example',
    'https://127.0.0.1.evil.com',
    'http://user:pass@127.0.0.1:3080',
    'file:///tmp/x',
    'null',
  ]
  for (const origin of bad) {
    const res = await fetch(base + '/persona-hub/api/select', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ key: 'aluna' }),
    })
    assert.equal(res.status, 403, origin)
    assert.equal((await res.json()).error, 'cross_origin', origin)
  }
  assert.equal(saved.length, 0)
})

test('写闸：同源 Origin 放行、空 Origin 也放行（同机脚本）', async () => {
  const same = await fetch(base + '/persona-hub/api/select', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ key: 'aluna' }),
  })
  assert.equal(same.status, 200)
  const noOrigin = await fetch(base + '/persona-hub/api/select', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'aluna' }),
  })
  assert.equal(noOrigin.status, 200)
})

test('写闸：Host 非本机/畸形 → 403 bad_host（DNS rebinding 防护）', async () => {
  const badHosts = ['evil.example', '[evil', '[]', ':8080', '127.0.0.1.evil.com']
  for (const host of badHosts) {
    const got = await rawRequest('/persona-hub/api/select', {
      headers: { host, 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'aluna' }),
    })
    assert.equal(got.status, 403, host)
    assert.equal(JSON.parse(got.body).error, 'bad_host', host)
  }
  const ok = await rawRequest('/persona-hub/api/select', {
    headers: { host: `127.0.0.1:${server.address().port}`, 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'aluna' }),
  })
  assert.equal(ok.status, 200)
})

test('写闸：DELETE 允许无 Content-Type，但跨源 Origin 仍 403、空 Origin 到业务', async () => {
  const bad = await fetch(base + '/persona-hub/api/personas/import', {
    method: 'DELETE', headers: { origin: 'http://evil.example' },
  })
  assert.equal(bad.status, 403)
  assert.equal((await bad.json()).error, 'cross_origin')

  // 过了闸才会遇到"保留名不是 key"的业务错误：证明确实没被 Content-Type 拦。
  const noCt = await fetch(base + '/persona-hub/api/personas/import', { method: 'DELETE' })
  assert.equal(noCt.status, 400)
  assert.equal((await noCt.json()).error, 'invalid_key')
})

test('checkWriteGate：回环地址非本机 → 403 not_loopback（allowRemote 也不放开写）', () => {
  const denied = checkWriteGate({
    method: 'POST',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    socket: { remoteAddress: '192.168.1.9' },
  })
  assert.deepEqual(denied, { status: 403, error: 'not_loopback' })
})

test('symlink 指向出厂目录：/config writable=false(is_shipped)，导入 409', async () => {
  const link = join(home, 'shipped-link')
  symlinkSync(SHIPPED_PROMPTS_DIR, link, 'dir')
  const previous = config.assets.dir
  config.assets.dir = link
  try {
    const cfg = (await (await fetch(base + '/persona-hub/api/config')).json()).config
    assert.equal(cfg.assets.effectiveDir, link)
    assert.equal(cfg.assets.writable, false, 'symlink 指向出厂目录必须判只读')
    assert.equal(cfg.assets.writeReason, 'is_shipped')

    const res = await fetch(base + '/persona-hub/api/personas/import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'viasymlink', text: '不应写进出厂目录' }),
    })
    assert.equal(res.status, 409)
    assert.equal((await res.json()).error, 'assets_dir_shipped')
  } finally {
    config.assets.dir = previous
  }
})

test('POST /config：非空 defaultPersona 资产不存在 → 400 invalid_config，不存死 key', async () => {
  const before = saved.length
  const res = await fetch(base + '/persona-hub/api/config', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config: { dsh: { enabled: true, defaultPersona: 'nosuchpersona' }, bots: {} } }),
  })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).error, 'invalid_config')
  assert.equal(saved.length, before, '被拒的配置不得落盘')

  const ok = await fetch(base + '/persona-hub/api/config', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config: { dsh: { enabled: true, defaultPersona: 'aluna' }, bots: {} } }),
  })
  assert.equal(ok.status, 200)
  const body = await ok.json()
  assert.equal(body.memoryHinted, true)
  assert.deepEqual(body.memoryHint, { sent: true, reason: 'ok' }, '返回体保留 memoryHinted 且新增 structured reason')
})

test('POST /select：资产不存在 → 400（与 /config 同口径，不落死 key）', async () => {
  const res = await fetch(base + '/persona-hub/api/select', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'nosuchpersona' }),
  })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).error, 'persona_missing')
})
