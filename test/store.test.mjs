import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listPersonas, readPersona, writeActive, readActive } from '../src/host/persona-store.js'

test('出厂三角色可读（bigfish/aluna/yiyi）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persona-'))
  const got = readPersona({ personaDir: dir }, 'bigfish')
  assert.equal(got.ok, true)
  assert.match(got.text, /大肥鱼/)
  const keys = listPersonas({ personaDir: dir }).map((x) => x.key)
  for (const k of ['bigfish', 'aluna', 'yiyi']) assert.ok(keys.includes(k), k)
})

test('key 白名单拒绝路径穿越', () => {
  assert.equal(readPersona({}, '../etc/passwd').ok, false)
  assert.equal(readPersona({}, '/etc/passwd').ok, false)
  assert.equal(readPersona({}, 'a/b').ok, false)
})

test('用户目录优先于出厂资产', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persona-'))
  writeFileSync(join(dir, 'bigfish.txt'), '自定义大肥鱼', 'utf8')
  const got = readPersona({ personaDir: dir }, 'bigfish')
  assert.equal(got.text, '自定义大肥鱼')
})

test('active 选择可写可读', () => {
  const home = mkdtempSync(join(tmpdir(), 'dshhome-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    mkdirSync(join(home, 'persona-hub'), { recursive: true })
    assert.equal(writeActive('aluna').ok, true)
    assert.equal(readActive().key, 'aluna')
    assert.equal(writeActive('../x').ok, false)
  } finally { if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old }
})
