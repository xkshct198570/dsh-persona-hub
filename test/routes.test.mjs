import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createRoutes } from '../src/host/routes.js'
import { createResolver } from '../src/host/resolver.js'
import { readPersona } from '../src/host/persona-store.js'
import { importPersona } from '../src/host/persona-admin.js'

let server, base
const hinted = []
const saved = []
const memService = { setIdentityHint(h) { hinted.push(h) } }
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

let oldHome
before(async () => {
  oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dshhome-'))
  // 开源包只带 bigfish；QQ 角色写用户目录（真实装机同样）
  importPersona(config, { key: 'aluna', name: '阿罗娜', text: '阿罗娜正文' })
  importPersona(config, { key: 'yiyi', name: '一叶', text: '一叶正文' })
  const resolver = createResolver({ config, store: { readPersona } })
  server = http.createServer(createRoutes({ config, hook, resolver, ctx }))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise((r) => server.close(r))
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
})

test('personas：出厂三角色 + dsh 默认', async () => {
  const res = await fetch(base + '/persona-hub/api/personas')
  const body = await res.json()
  const keys = body.items.map((x) => x.key)
  for (const k of ['bigfish', 'aluna', 'yiyi']) assert.ok(keys.includes(k), k)
  assert.equal(body.dsh.defaultPersona, 'bigfish')
})

test('resolve：dsh 命中 bigfish', async () => {
  const res = await fetch(base + '/persona-hub/api/resolve?source=dsh')
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.persona.personaKey, 'bigfish')
})

test('select：切到 aluna、保存配置并给记忆包发提示', async () => {
  const res = await fetch(base + '/persona-hub/api/select', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'aluna' }),
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.key, 'aluna')
  assert.deepEqual(body.identityHint, { roleId: 'aluna', workspace: 'web' })
  assert.equal(body.memoryHinted, true)
  assert.deepEqual(hinted.at(-1), { roleId: 'aluna', workspace: 'web' })
  assert.equal(saved.at(-1).dsh.defaultPersona, 'aluna')
})

test('导入人设：写用户资产并出现在列表', async () => {
  const res = await fetch(base + '/persona-hub/api/personas/import', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'customone', name: '自定义', text: '你是自定义角色。' }) })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.key, 'customone')
  const list = await (await fetch(base + '/persona-hub/api/personas')).json()
  const item = list.items.find((x) => x.key === 'customone')
  assert.equal(item.deletable, true)
  assert.equal(item.origin, 'user')
})

test('删除人设：出厂不可删；用户副本可删', async () => {
  const shipped = await fetch(base + '/persona-hub/api/personas/bigfish', { method: 'DELETE' })
  assert.equal(shipped.status, 409)
  assert.equal((await shipped.json()).error, 'persona_shipped_immutable')
  const ok = await fetch(base + '/persona-hub/api/personas/customone', { method: 'DELETE' })
  assert.equal(ok.status, 200)
})

test('POST /config：保存多主体配置', async () => {
  const next = {
    dsh: { enabled: true, defaultPersona: 'bigfish' },
    bots: { '10001': { enabled: true, platform: 'qq',
      private: { enabled: true, defaultPersona: 'aluna', bindings: { '20002': 'yiyi' } },
      group: { enabled: true, defaultPersona: 'yiyi', bindings: {} } } },
  }
  const res = await fetch(base + '/persona-hub/api/config', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: next }),
  })
  assert.equal(res.status, 200)
  assert.equal(saved.at(-1).bots['10001'].private.bindings['20002'], 'yiyi')
  const body = await res.json()
  assert.equal(body.memoryHinted, true)
  assert.deepEqual(hinted.at(-1), { roleId: '', workspace: 'web' })
})
