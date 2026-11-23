/**
 * 字符数按 Unicode 码点（R9-08 第 7 项）：emoji/异体字占两个 UTF-16 码元，
 * `.length` 会虚高；list/read/import 三处 `chars` 与 200k 上限都必须按码点。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { listPersonas, readPersona, charCount } from '../src/host/persona-store.js'
import { importPersona } from '../src/host/persona-admin.js'
import { createRoutes } from '../src/host/routes.js'
import { createResolver } from '../src/host/resolver.js'

const EMOJI_TEXT = '🐟🐟🐟你是大肥鱼'
const EMOJI_CODE_POINTS = 8 // 3 emoji + 5 汉字
const EMOJI_UTF16 = 11 // 每个 emoji 占 2 个码元

function withTempHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'persona-cp-'))
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = home
  return Promise.resolve()
    .then(() => fn(home))
    .finally(() => {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
      rmSync(home, { recursive: true, force: true })
    })
}

test('charCount：按码点而不是 UTF-16 码元', () => {
  assert.equal(EMOJI_TEXT.length, EMOJI_UTF16)
  assert.equal(charCount(EMOJI_TEXT), EMOJI_CODE_POINTS)
  assert.equal(charCount(''), 0)
})

test('readPersona/listPersonas：chars 按码点（emoji 人设）', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'persona-hub', 'prompts')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'fishy.txt'), EMOJI_TEXT, 'utf8')
    const cfg = { assets: { dir } }

    const got = readPersona(cfg, 'fishy')
    assert.equal(got.ok, true)
    assert.equal(got.chars, EMOJI_CODE_POINTS, 'chars 不得用 .length 的 11')
    const item = listPersonas(cfg).find((x) => x.key === 'fishy')
    assert.equal(item.chars, EMOJI_CODE_POINTS)
  })
})

test('importPersona：chars 按码点', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'persona-hub', 'prompts')
    mkdirSync(dir, { recursive: true })
    const cfg = { assets: { dir } }
    const got = importPersona(cfg, { key: 'fishy', text: EMOJI_TEXT })
    assert.equal(got.ok, true)
    assert.equal(got.chars, EMOJI_CODE_POINTS)
  })
})

test('200k 上限按码点：5 个 emoji（10 码元）在 maxChars=5 下可读，4 下拒', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'persona-hub', 'prompts')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'five.txt'), '🐟'.repeat(5), 'utf8')
    assert.equal(readPersona({ assets: { dir }, maxChars: 5 }, 'five').ok, true,
      '按码点 5 个字符，不得因 10 个码元被判超限')
    assert.equal(readPersona({ assets: { dir }, maxChars: 4 }, 'five').error, 'persona_too_large')
  })
})

test('GET /persona 预览 chars 按码点（与 readPersona 同源）', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'persona-hub', 'prompts')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'fishy.txt'), EMOJI_TEXT, 'utf8')
    const config = { dsh: { enabled: true, defaultPersona: 'fishy' }, bots: {}, assets: { dir, watch: false }, panel: { allowRemote: false } }
    const ctx = { get() { return undefined }, fiber: { entry: {} } }
    const server = http.createServer(createRoutes({
      config, hook: { refresh() {} }, resolver: createResolver({ config, store: { readPersona } }), ctx,
    }))
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    try {
      const base = `http://127.0.0.1:${server.address().port}`
      const body = await (await fetch(`${base}/persona-hub/api/persona?key=fishy`)).json()
      assert.equal(body.chars, EMOJI_CODE_POINTS)
      assert.equal(body.chars, charCount(body.text))
    } finally {
      await new Promise((r) => server.close(r))
    }
  })
})
