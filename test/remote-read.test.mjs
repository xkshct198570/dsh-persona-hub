/**
 * P1 远端读面收口：allowRemote=true 时非回环地址只剩「角色列表」一层可用。
 *
 * 锁住（真 payload，不只看 200）：
 *   - 非回环 GET /config → 403 read_only_remote（含主体绑定目标号，不得外发）；
 *   - 非回环 GET /persona → 403 read_only_remote（人设正文不外发）；
 *   - 非回环 GET /personas → 200 但脱敏：条目只有 key/显示名/来源/是否绑定，无目标号、无绝对路径；
 *   - 非回环 GET /resolve?include_text=1 → 200 但无正文（否则绕过 /persona 的 403）；
 *   - 回环三者照常 200，形状与 allowRemote=false 时一致；
 *   - allowRemote=false 时非回环仍 403 not_loopback（既有行为不变）。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createRoutes } from '../src/host/routes.js'
import { createResolver } from '../src/host/resolver.js'
import { importPersona } from '../src/host/persona-admin.js'
import { readPersona } from '../src/host/persona-store.js'

const BOUND = '10.9.9.9'
const TARGET = '1246277257'
const BOT = '1127704268'
const config = {
  dsh: { enabled: true, defaultPersona: 'bigfish' },
  bots: {
    [BOT]: {
      enabled: true,
      platform: 'qq',
      private: { enabled: true, defaultPersona: 'aluna', bindings: { [TARGET]: 'aluna' } },
      group: { enabled: true, defaultPersona: 'yiyi', bindings: {} },
    },
  },
  assets: { dir: '', watch: false },
  panel: { allowRemote: true },
}
const ctx = { fiber: { entry: {} }, webServer: { host: BOUND }, get: () => undefined }
const hook = { refresh() {} }
const headers = { host: `${BOUND}:3080`, origin: `http://${BOUND}:3080` }

let handler, server, base, home, oldHome

/** 直接调 handler 并伪造 socket.remoteAddress（原生 http 服务端拿不到非回环地址）。 */
function remoteCall(path, remote = BOUND, reqHeaders = headers) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      body: '',
      headersSent: false,
      writableEnded: false,
      setHeader() {},
      end(chunk) {
        this.writableEnded = true
        this.body = String(chunk)
        resolve({ status: this.statusCode, body: this.body })
      },
    }
    void handler({ url: path, method: 'GET', socket: { remoteAddress: remote }, headers: reqHeaders }, res)
  })
}

before(async () => {
  oldHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'persona-remote-'))
  process.env.DSH_HOME = home
  importPersona(config, { key: 'aluna', name: '阿罗娜', text: '阿罗娜正文（远端不可读）' })
  importPersona(config, { key: 'yiyi', name: '一叶', text: '一叶正文' })
  const resolver = createResolver({ config, store: { readPersona } })
  handler = createRoutes({ config, hook, resolver, ctx })
  server = http.createServer(handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise((r) => server.close(r))
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
})

test('P1 非回环：GET /config → 403 read_only_remote，且不回泄漏绑定目标号', async () => {
  const got = await remoteCall('/persona-hub/api/config')
  assert.equal(got.status, 403)
  const body = JSON.parse(got.body)
  assert.equal(body.ok, false)
  assert.equal(body.error, 'read_only_remote')
  assert.equal(got.body.includes('bindings'), false, '403 响应体不得带回配置内容')
  assert.equal(got.body.includes(TARGET), false, '目标号不得出现在错误响应里')
})

test('P1 非回环：GET /persona → 403 read_only_remote，人设正文不外发', async () => {
  const got = await remoteCall('/persona-hub/api/persona?key=aluna')
  assert.equal(got.status, 403)
  assert.equal(JSON.parse(got.body).error, 'read_only_remote')
  assert.equal(got.body.includes('阿罗娜正文'), false)
})

test('P1 非回环：GET /personas 200 但脱敏（无目标号、无绝对路径、只有绑定布尔）', async () => {
  const got = await remoteCall('/persona-hub/api/personas')
  assert.equal(got.status, 200)
  const body = JSON.parse(got.body)
  assert.equal(body.ok, true)

  // 条目形状：key/显示名/来源/是否绑定；chars/avatar/description/deletable 不外发。
  for (const item of body.items) {
    assert.deepEqual(Object.keys(item).sort(), ['bound', 'key', 'name', 'origin'], `条目字段越界：${JSON.stringify(item)}`)
    assert.equal(typeof item.bound, 'boolean')
  }
  const byKey = Object.fromEntries(body.items.map((item) => [item.key, item]))
  assert.equal(byKey.aluna.bound, true, 'aluna 被主体通道引用，bound 应为 true')
  assert.equal(byKey.bigfish.bound, false, 'bigfish 只作网页端默认，不算主体绑定')

  // 目标号与绝对路径一律不外发。
  assert.equal(got.body.includes(TARGET), false, '绑定目标号泄漏')
  assert.equal(got.body.includes('bindings'), false, 'bindings 字段泄漏')
  assert.equal(got.body.includes(home), false, 'DSH_HOME 绝对路径泄漏')
  assert.equal(got.body.includes('prompts'), false, '资产目录绝对路径泄漏')
  assert.deepEqual(Object.keys(body.assets).sort(), ['watch', 'writable', 'writeReason'], 'assets 不得带 dir/effectiveDir')
  assert.equal(body.assets.writable, true)
})

test('P1 非回环：GET /resolve?include_text=1 保留结构但不含正文', async () => {
  const got = await remoteCall(`/persona-hub/api/resolve?source=qq&bot_id=${BOT}&chat_type=private&target_id=${TARGET}&include_text=1`)
  assert.equal(got.status, 200)
  const body = JSON.parse(got.body)
  assert.equal(body.persona.personaKey, 'aluna')
  assert.equal(typeof body.persona.text, 'undefined', 'include_text 不得让远端读到正文')
  assert.equal(got.body.includes('阿罗娜正文'), false)
  assert.equal(body.reason, 'ok')
})

test('P1 回环：/config、/persona、/personas 均 200 且形状不变', async () => {
  const cfg = await (await fetch(`${base}/persona-hub/api/config`)).json()
  assert.equal(cfg.config.bots[BOT].private.bindings[TARGET], 'aluna', '回环仍应拿到完整配置')
  assert.equal(typeof cfg.config.assets.effectiveDir, 'string')
  assert.equal(cfg.config.panel.allowRemote, true)

  const one = await (await fetch(`${base}/persona-hub/api/persona?key=aluna`)).json()
  assert.equal(one.text, '阿罗娜正文（远端不可读）')

  const list = await (await fetch(`${base}/persona-hub/api/personas`)).json()
  const item = list.items.find((it) => it.key === 'aluna')
  assert.equal(item.chars, one.chars, '回环条目保留 chars')
  assert.equal('bound' in item, false, '回环 /personas 条目不得新增 bound 字段（形状不变）')
  assert.equal(typeof list.assets.effectiveDir, 'string')
})

test('P1 既有行为：allowRemote=false 时非回环一律 403 not_loopback', async () => {
  const previous = config.panel.allowRemote
  config.panel.allowRemote = false
  try {
    // allowRemote=false 时绑定地址也不再是合法 Host：用本机 Host 才能走到回环判定。
    const localHeaders = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }
    for (const path of ['/persona-hub/api/personas', '/persona-hub/api/config', '/persona-hub/api/persona?key=bigfish']) {
      const got = await remoteCall(path, BOUND, localHeaders)
      assert.equal(got.status, 403, path)
      assert.equal(JSON.parse(got.body).error, 'not_loopback', path)
    }
  } finally {
    config.panel.allowRemote = previous
  }
})
