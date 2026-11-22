import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { chmodSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createRoutes } from '../src/host/routes.js'
import { createResolver } from '../src/host/resolver.js'
import { readPersona } from '../src/host/persona-store.js'
import { importPersona } from '../src/host/persona-admin.js'

let server, base
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


test('POST /reload：200（fs.watch=false 时的手工重读入口）', async () => {
  const res = await fetch(base + '/persona-hub/api/reload', { method: 'POST' })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(typeof body.reloadedAt, 'number')
})

test('写盘异常兜成 JSON：只读目录 → 500 write_failed（不是网络错误）', async () => {
  const home = process.env.DSH_HOME
  const hub = join(home, 'persona-hub')
  mkdirSync(hub, { recursive: true })
  chmodSync(hub, 0o500)
  try {
    const res = await fetch(base + '/persona-hub/api/personas/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'readonlyone', text: '只读目录导入' }),
    })
    assert.equal(res.status, 500)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.error, 'write_failed')
    assert.ok(typeof body.detail === 'string' && body.detail.length > 0)

    const cfg = await (await fetch(base + '/persona-hub/api/config')).json()
    assert.equal(cfg.config.assets.writable, false, '只读目录必须如实回报')
    assert.equal(cfg.config.assets.writeReason, 'not_writable')
  } finally {
    chmodSync(hub, 0o700)
  }
})

test('GET /config：panel 3 字段 + assets 2 字段（dir 空回真实路径）', async () => {
  const body = await (await fetch(base + '/persona-hub/api/config')).json()
  const cfg = body.config
  assert.deepEqual(Object.keys(cfg.panel).sort(), ['allowRemote', 'pollMs', 'tab'])
  assert.equal(cfg.panel.allowRemote, false)
  assert.equal(cfg.panel.pollMs, 60000)
  assert.equal(cfg.panel.tab, 'personas')
  assert.equal(cfg.assets.dir, '')
  assert.ok(cfg.assets.effectiveDir.startsWith('/'), '空 dir 必须回真实默认路径')
  assert.ok(cfg.assets.effectiveDir.endsWith(join('persona-hub', 'prompts')))
  assert.equal(cfg.assets.watch, false)
  assert.equal(cfg.assets.writable, true)
})

test('POST /config：5 个字段保存并回读一致（走 configEditor）', async () => {
  const next = {
    dsh: { enabled: true, defaultPersona: 'bigfish' },
    bots: {},
    assets: { dir: '/tmp/persona-hub-assets-test', watch: false },
    panel: { allowRemote: true, pollMs: 120000, tab: 'bots' },
  }
  const res = await fetch(base + '/persona-hub/api/config', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: next }),
  })
  assert.equal(res.status, 200)
  const savedCfg = saved.at(-1)
  assert.equal(savedCfg.assets.dir, '/tmp/persona-hub-assets-test')
  assert.equal(savedCfg.assets.watch, false)
  assert.equal(savedCfg.panel.allowRemote, true)
  assert.equal(savedCfg.panel.pollMs, 120000)
  assert.equal(savedCfg.panel.tab, 'bots')

  const cfg = (await (await fetch(base + '/persona-hub/api/config')).json()).config
  assert.equal(cfg.assets.dir, '/tmp/persona-hub-assets-test')
  assert.equal(cfg.assets.effectiveDir, '/tmp/persona-hub-assets-test')
  assert.equal(cfg.panel.allowRemote, true)
  assert.equal(cfg.panel.pollMs, 120000)
  assert.equal(cfg.panel.tab, 'bots')
})

test('POST /config：panel/assets 越界值拒绝（pollMs 上限、tab 白名单、watch 类型）', async () => {
  const baseCfg = { dsh: { enabled: true, defaultPersona: 'bigfish' }, bots: {} }
  const bad = [
    [{ ...baseCfg, panel: { allowRemote: false, pollMs: 1000, tab: 'personas' } }, 'invalid_panel'],
    [{ ...baseCfg, panel: { allowRemote: false, pollMs: 6000000, tab: 'personas' } }, 'invalid_panel'],
    [{ ...baseCfg, panel: { allowRemote: false, pollMs: 60000, tab: 'nope' } }, 'invalid_panel'],
    [{ ...baseCfg, assets: { dir: '', watch: 'yes' } }, 'invalid_assets'],
  ]
  for (const [config, error] of bad) {
    const res = await fetch(base + '/persona-hub/api/config', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config }),
    })
    assert.equal(res.status, 400, JSON.stringify(config))
    assert.equal((await res.json()).error, error)
  }
})

test('POST /config：bot_id 允许 QQ 数字号；空格/保留平台/坏绑定值拒绝', async () => {
  const bot = () => ({ enabled: true, platform: 'qq',
    private: { enabled: true, defaultPersona: '', bindings: {} },
    group: { enabled: true, defaultPersona: '', bindings: {} } })
  const ok = { dsh: { enabled: true, defaultPersona: 'bigfish' }, bots: { '1127704268': bot(), 'a.b_c:d-1': bot() } }
  const okRes = await fetch(base + '/persona-hub/api/config', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: ok }),
  })
  assert.equal(okRes.status, 200)

  const cases = [
    { 'bad id': bot() },
    { '10001': { ...bot(), platform: 'dsh' } },
    { '10001': { ...bot(), platform: '' } },
    { '10001': { ...bot(), private: { enabled: true, defaultPersona: '', bindings: { '20002': 'Bad Key' } } } },
    { '10001': { ...bot(), private: { enabled: true, defaultPersona: '', bindings: { '20002': '' } } } },
  ]
  for (const bots of cases) {
    const res = await fetch(base + '/persona-hub/api/config', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: { dsh: { enabled: true, defaultPersona: 'bigfish' }, bots } }),
    })
    assert.equal(res.status, 400, JSON.stringify(bots))
    assert.equal((await res.json()).error, 'invalid_bots')
  }
})

test('GET /resolve：null 时带 reason/layer（与 explain 同源）；命中时 reason=ok', async () => {
  const miss = await (await fetch(base + '/persona-hub/api/resolve?source=qq&bot_id=999&chat_type=private')).json()
  assert.equal(miss.ok, true)
  assert.equal(miss.persona, null)
  assert.equal(miss.reason, 'bot_unknown')
  assert.equal(miss.layer, 'bot')

  const empty = await (await fetch(base + '/persona-hub/api/resolve')).json()
  assert.equal(empty.reason, 'source_missing')
  assert.equal(empty.layer, 'entry')

  const hit = await (await fetch(base + '/persona-hub/api/resolve?source=dsh')).json()
  assert.equal(hit.reason, 'ok')
  assert.equal(hit.layer, 'dsh')
})

test('DELETE /personas/import：保留名不当作 key 删除', async () => {
  const res = await fetch(base + '/persona-hub/api/personas/import', { method: 'DELETE' })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).error, 'invalid_key')
})


test('身份提示：网页端关闭时清旧提示、不发新提示', async () => {
  const res = await fetch(base + '/persona-hub/api/config', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config: { dsh: { enabled: false, defaultPersona: 'bigfish' }, bots: {} } }),
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.memoryHinted, false)
  assert.equal(cleared.at(-1), true, 'dsh.enabled=false 必须 clearIdentityHint')
})
