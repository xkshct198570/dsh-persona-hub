/**
 * P2 保存回读语义（POST /config）：
 *   - commitConfig 写盘成功后回读 config.json 校验 dsh/bots；
 *   - 回读失败/不一致 → 仍 ok:true + readBackFailed:true + readBackReason 短码（配置确实落盘）；
 *   - 只有写盘失败才 501 ok:false（维持既有错误形状），不得把成功报成失败。
 *
 * 回读校验真身是 config-mirror.verifyConfigMirror（本文件同时单测它）；路由层用注入的
 * verifyReadBack 桩复现「回读抛错 / 字段不一致」，避免靠碰文件权限制造平台相关偶发。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { createRoutes } from '../src/host/routes.js'
import { createResolver } from '../src/host/resolver.js'
import { readPersona } from '../src/host/persona-store.js'
import { mirrorPath, verifyConfigMirror } from '../src/host/config-mirror.js'

const BOT = '10001'
const TARGET = '20002'
const payload = {
  config: {
    dsh: { enabled: true, defaultPersona: 'bigfish' },
    bots: {
      [BOT]: {
        enabled: true,
        platform: 'qq',
        private: { enabled: true, defaultPersona: 'bigfish', bindings: { [TARGET]: 'bigfish' } },
        group: { enabled: true, defaultPersona: '', bindings: {} },
      },
    },
  },
}

const editorState = { fail: false }
const editor = {
  async edit(_entry, fn) {
    if (editorState.fail) throw new Error('disk full')
    fn({ dsh: { enabled: true, defaultPersona: 'bigfish' }, bots: {} })
    return {}
  },
}
const config = { dsh: { enabled: true, defaultPersona: 'bigfish' }, bots: {}, assets: { dir: '', watch: false }, panel: { allowRemote: false } }
const ctx = {
  fiber: { entry: {} },
  get(name) {
    if (name === 'configEditor') return editor
    return undefined
  },
}
const hook = { refresh() {} }

let home, oldHome, handler
const resolver = createResolver({ config, store: { readPersona } })

/** 直接调 handler：POST /config 需要可迭代 body（原生 http 不便伪造回环失败桩的写法）。 */
function postConfig(routeHandler, body = payload) {
  return new Promise((resolve) => {
    const text = JSON.stringify(body)
    const req = {
      url: '/persona-hub/api/config',
      method: 'POST',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(text) },
    }
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
    void routeHandler(req, res)
  })
}

function makeHandler(verifyReadBack) {
  return createRoutes({ config, hook, resolver, ctx, verifyReadBack })
}

function readMirror() {
  return JSON.parse(readFileSync(mirrorPath(), 'utf8'))
}

before(() => {
  oldHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'persona-readback-'))
  process.env.DSH_HOME = home
  handler = makeHandler()
})
after(() => {
  if (existsSync(home)) rmSync(home, { recursive: true, force: true })
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
})

test('P2 写盘失败：501 ok:false（既有错误形状），且镜像未落盘', async () => {
  editorState.fail = true
  try {
    assert.equal(existsSync(mirrorPath()), false, '前置：此用例前不应已有镜像文件')
    const got = await postConfig(makeHandler())
    assert.equal(got.status, 501)
    const body = JSON.parse(got.body)
    assert.equal(body.ok, false, '写盘失败必须报失败')
    assert.equal(body.error, 'config_save_failed')
    assert.equal(existsSync(mirrorPath()), false, '写盘失败不得留下镜像文件')
    assert.equal(config.bots[BOT], undefined, '写盘失败不得就地更新运行时配置')
  } finally {
    editorState.fail = false
  }
})

test('P2 回读抛错：仍 ok:true + readBackFailed:true，且配置文件确实落盘', async () => {
  const got = await postConfig(makeHandler(() => { throw new Error('read-back boom') }))
  assert.equal(got.status, 200, '写盘成功不得报失败')
  const body = JSON.parse(got.body)
  assert.equal(body.ok, true)
  assert.equal(body.readBackFailed, true)
  assert.equal(body.readBackReason, 'read_failed', '回读异常收敛成短码')
  assert.equal(got.body.includes('read-back boom'), false, '响应不得带异常正文')

  // 反证：文件真的写了，且字段与提交一致（否则「已保存」是假的）。
  assert.equal(existsSync(mirrorPath()), true)
  const mirror = readMirror()
  assert.equal(mirror.dsh.enabled, true)
  assert.equal(mirror.dsh.defaultPersona, 'bigfish')
  assert.equal(mirror.bots[BOT].private.bindings[TARGET], 'bigfish')
})

test('P2 回读字段不一致：仍 ok:true + readBackFailed:true（不把成功报成失败）', async () => {
  const got = await postConfig(makeHandler(() => ({ ok: false, reason: 'mismatch_dsh' })))
  assert.equal(got.status, 200)
  const body = JSON.parse(got.body)
  assert.equal(body.ok, true)
  assert.equal(body.readBackFailed, true)
  assert.equal(body.readBackReason, 'mismatch_dsh')
})

test('P2 真回读一致：200 且不带 readBackFailed 字段', async () => {
  const got = await postConfig(makeHandler())
  assert.equal(got.status, 200)
  const body = JSON.parse(got.body)
  assert.equal(body.ok, true)
  assert.equal('readBackFailed' in body, false, '回读一致时不得带 readBackFailed')
  assert.equal(verifyConfigMirror(config).ok, true, '真回读校验应通过')
})

test('P2 verifyConfigMirror：一致/缺文件/坏 JSON/dsh 不一致/bots 不一致 → 短码', () => {
  const dir = join(home, 'verify-fixtures')
  mkdirSync(dirname(join(dir, 'config.json')), { recursive: true })
  const path = join(dir, 'config.json')
  const expected = {
    dsh: { enabled: true, defaultPersona: 'bigfish' },
    bots: { [BOT]: { enabled: true, platform: 'qq', private: { enabled: true, defaultPersona: 'bigfish', bindings: { [TARGET]: 'bigfish' } }, group: { enabled: true, defaultPersona: '', bindings: {} } } },
  }
  writeFileSync(path, JSON.stringify({ version: 1, updatedAt: 1, ...expected }), 'utf8')
  assert.deepEqual(verifyConfigMirror(expected, path), { ok: true })

  assert.deepEqual(verifyConfigMirror(expected, join(dir, 'missing.json')), { ok: false, reason: 'read_failed' })

  const broken = join(dir, 'broken.json')
  writeFileSync(broken, '{ not json', 'utf8')
  assert.deepEqual(verifyConfigMirror(expected, broken), { ok: false, reason: 'parse_failed' })

  const dshDiff = join(dir, 'dsh-diff.json')
  writeFileSync(dshDiff, JSON.stringify({ dsh: { enabled: true, defaultPersona: 'aluna' }, bots: expected.bots }), 'utf8')
  assert.deepEqual(verifyConfigMirror(expected, dshDiff), { ok: false, reason: 'mismatch_dsh' })

  const botsDiff = join(dir, 'bots-diff.json')
  writeFileSync(botsDiff, JSON.stringify({ dsh: expected.dsh, bots: {} }), 'utf8')
  assert.deepEqual(verifyConfigMirror(expected, botsDiff), { ok: false, reason: 'mismatch_bots' })
})
