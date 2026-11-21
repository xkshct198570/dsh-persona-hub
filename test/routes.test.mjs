import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRoutes } from '../src/host/routes.js'

let server, base
const hinted = []
const memService = { setIdentityHint(h) { hinted.push(h) } }
const hook = { refresh() {}, activeKey() { return 'bigfish' } }
const ctx = { get(name) { return name === 'whaleMemory' ? memService : undefined } }

before(async () => {
  const handler = createRoutes({ config: { defaultPersona: 'bigfish', injectEnabled: true, panel: { allowRemote: false } }, hook, ctx })
  server = http.createServer(handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await new Promise((r) => server.close(r)) })

test('select：切到 aluna 并给记忆包发身份提示', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dshhome-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
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
  } finally { if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old }
})

test('personas：出厂三角色在列表中', async () => {
  const res = await fetch(base + '/persona-hub/api/personas')
  const body = await res.json()
  const keys = body.items.map((x) => x.key)
  for (const k of ['bigfish', 'aluna', 'yiyi']) assert.ok(keys.includes(k), k)
})
