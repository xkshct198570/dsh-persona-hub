/**
 * R10 安全回归：读接口也必须过 Host/Origin 闸（DNS rebinding），allowRemote 只认绑定地址；
 * 以及配置保存保留 volatile Ref 引用身份。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRoutes } from '../src/host/routes.js'
import { createResolver } from '../src/host/resolver.js'
import { readPersona } from '../src/host/persona-store.js'
import { isAllowedHost, isAllowedOrigin } from '../src/host/http-kit.js'
import { mergePreservingVolatile, isVolatileRef } from '../src/host/config-values.js'

const BOUND = '10.9.9.9'
const config = {
  dsh: { enabled: true, defaultPersona: 'bigfish' },
  bots: {},
  assets: { dir: '', watch: false },
  panel: { allowRemote: true },
}
const ctx = { fiber: { entry: {} }, webServer: { host: BOUND }, get: () => undefined }
const hook = { refresh() {} }
let server, base, oldHome

function request(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

before(async () => {
  oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'persona-r10-'))
  const resolver = createResolver({ config, store: { readPersona } })
  server = http.createServer(createRoutes({ config, hook, resolver, ctx }))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise((r) => server.close(r))
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
})

test('读接口 Host 闸：伪造 Host 一律 403（DNS rebinding 收口）', async () => {
  const evil = await request('/persona-hub/api/persona?key=bigfish', { host: 'evil.example' })
  assert.equal(evil.status, 403)
  assert.match(evil.body, /bad_host/)

  const evilConfig = await request('/persona-hub/api/config', { host: 'evil.example' })
  assert.equal(evilConfig.status, 403)

  const local = await request('/persona-hub/api/personas', { host: '127.0.0.1' })
  assert.equal(local.status, 200)
})

test('allowRemote：只放行 webServer 绑定地址，其他外部 Host/Origin 仍拒绝', async () => {
  const bound = await request('/persona-hub/api/personas', { host: `${BOUND}:3080` })
  assert.equal(bound.status, 200, bound.body.slice(0, 200))

  const other = await request('/persona-hub/api/personas', { host: '10.9.9.10:3080' })
  assert.equal(other.status, 403)

  const badOrigin = await request('/persona-hub/api/personas', {
    host: '127.0.0.1', origin: 'https://evil.example',
  })
  assert.equal(badOrigin.status, 403)
  assert.match(badOrigin.body, /cross_origin/)
})

test('isAllowedHost / isAllowedOrigin：绑定地址等值比较，IPv6 括号归一', () => {
  assert.equal(isAllowedHost('127.0.0.1:3080'), true)
  assert.equal(isAllowedHost('10.9.9.9:3080', [BOUND]), true)
  assert.equal(isAllowedHost('[::1]:3080'), true)
  assert.equal(isAllowedHost('[fe80::1]:3080', ['fe80::1']), true)
  assert.equal(isAllowedHost('evil.example', [BOUND]), false)
  assert.equal(isAllowedOrigin('http://10.9.9.9:3080', [BOUND]), true)
  assert.equal(isAllowedOrigin('https://evil.example', [BOUND]), false)
  assert.equal(isAllowedOrigin('null', [BOUND]), false)
})

test('mergePreservingVolatile：保留 Ref 身份，只写值', () => {
  const writeSymbol = Symbol.for('cosmokit.volatile.write')
  let value = true
  const ref = Object.freeze({ get: () => value, [writeSymbol]: (next) => { value = next } })
  assert.equal(isVolatileRef(ref), true)
  const assets = { watch: ref, dir: '' }
  mergePreservingVolatile(assets, { watch: false })
  assert.equal(assets.watch, ref)
  assert.equal(assets.watch.get(), false)
})
