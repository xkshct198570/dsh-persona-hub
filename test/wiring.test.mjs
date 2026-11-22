/**
 * apply() 接线回归：C 包对外 service 的 resolvePersona 必须能真正解析。
 *
 * 为什么单独测接线而不是只测 resolver：2026-11-22 实测 `GET /persona-hub/api/resolve`
 * 对任何 source 都回 `persona:null`（reason=resolve_error），根因是 index.js 建 resolver 时
 * 用了未 import 的 readPersona —— resolver 单测各自 import 了它，所以测试全绿、线上全坏。
 * 本用例直接跑 apply() + 假 ctx，抓 service 与 /resolve 路由，锁住"入口层的依赖齐全"。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, Config } from '../index.js'

function makeCtx() {
  const captured = { handler: null, service: null, section: null }
  const disposers = []
  const ctx = {
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return () => {} },
    on: () => () => {},
    provide: (name, svc) => { if (name === 'personaHub') captured.service = svc },
    get: () => undefined,
    webServer: { register: ({ handler }) => { captured.handler = handler; return () => {} } },
    systemPrompt: { section: (s) => { captured.section = s; return () => {} } },
  }
  return { ctx, captured, dispose: () => { for (const d of disposers) { try { d() } catch { /* noop */ } } } }
}

function fakeRequest(handler, url) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      body: '',
      writeHead(code) { this.statusCode = code },
      setHeader() {},
      end(chunk) { this.body = String(chunk); resolve({ status: this.statusCode, body: this.body }) },
    }
    handler({ url, method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: {} }, res)
  })
}

function makeAssets() {
  // 出厂包只带 bigfish；aluna/yiyi 是本机用户资产。测试用夹具目录显式指向，
  // 不读真实 ~/.dsh（否则换机/清库时测试会假红，也无法证明 binding 路由）。
  const dir = mkdtempSync(join(tmpdir(), 'persona-hub-assets-'))
  writeFileSync(join(dir, 'aluna.txt'), '你是阿罗娜（测试夹具）\n')
  writeFileSync(join(dir, 'yiyi.txt'), '你是一叶（测试夹具）\n')
  return dir
}

function buildConfig(assetsDir) {
  return Config({
    dsh: { enabled: true, defaultPersona: 'bigfish' },
    bots: {
      1127704268: {
        enabled: true,
        platform: 'qq',
        private: { enabled: true, defaultPersona: 'aluna', bindings: { 1246277257: 'aluna' } },
        group: { enabled: true, defaultPersona: 'yiyi', bindings: { 1014710974: 'yiyi' } },
      },
    },
    assets: { dir: assetsDir, watch: false },
  })
}

test('接线：personaHub.resolvePersona(dsh) 命中 bigfish，qq 私聊命中 aluna', () => {
  const home = mkdtempSync(join(tmpdir(), 'persona-hub-wiring-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const { ctx, captured, dispose } = makeCtx()
  try {
    const assets = makeAssets()
    apply(ctx, buildConfig(assets))
    assert.ok(captured.service, 'apply 必须 provide personaHub service')
    assert.equal(typeof captured.service.resolvePersona, 'function')

    const dsh = captured.service.resolvePersona({ source: 'dsh' })
    assert.ok(dsh, 'dsh 源必须解析出人设（resolve_error 说明入口依赖缺失）')
    assert.equal(dsh.personaKey, 'bigfish')
    assert.match(dsh.text, /大肥鱼/)
    assert.equal(captured.service.explainResolve({ source: 'dsh' }).reason, 'ok')

    const priv = captured.service.resolvePersona({
      source: 'qq', bot_id: '1127704268', chat_type: 'private', target_id: '1246277257',
    })
    assert.ok(priv, 'qq 私聊必须按 binding 解析')
    assert.equal(priv.personaKey, 'aluna')
    assert.equal(priv.text.includes('测试夹具'), true, 'binding 命中用户资产本体')
    assert.equal(captured.service.explainResolve({
      source: 'qq', bot_id: '1127704268', chat_type: 'private', target_id: '1246277257',
    }).reason, 'ok')

    const grp = captured.service.resolvePersona({
      source: 'qq', bot_id: '1127704268', chat_type: 'group', target_id: '1014710974',
    })
    assert.equal(grp?.personaKey, 'yiyi')
  } finally {
    dispose()
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  }
})

test('接线：/resolve 路由与 service 同口径（不再恒 null）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'persona-hub-wiring-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const { ctx, captured, dispose } = makeCtx()
  try {
    const assets = makeAssets()
    apply(ctx, buildConfig(assets))
    assert.ok(captured.handler, 'apply 必须注册 /persona-hub/api 路由')
    const dsh = await fakeRequest(captured.handler, '/persona-hub/api/resolve?source=dsh')
    assert.equal(dsh.status, 200)
    const body = JSON.parse(dsh.body)
    assert.equal(body.ok, true)
    assert.ok(body.persona, '路由必须返回人设而不是 null')
    assert.equal(body.persona.personaKey, 'bigfish')

    const qq = await fakeRequest(captured.handler, '/persona-hub/api/resolve?source=qq&bot_id=1127704268&chat_type=private&target_id=1246277257')
    const qqBody = JSON.parse(qq.body)
    assert.equal(qqBody.persona?.personaKey, 'aluna')
  } finally {
    dispose()
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  }
})
