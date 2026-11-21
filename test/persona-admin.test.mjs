import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { importPersona, deletePersona, findPersonaUsage, isUserPersona } from '../src/host/persona-admin.js'
import { listPersonas, readPersona } from '../src/host/persona-store.js'

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'dshhome-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const cfg = { assets: { dir: join(home, 'prompts') } }
  try { return fn(cfg, home) } finally { if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old }
}

test('导入：写 prompts/key.txt 与 meta.json（原子写、0600）', () => withHome((cfg, home) => {
  const r = importPersona(cfg, { key: 'newone', name: '新角色', text: '你是新角色，说话简短。' })
  assert.equal(r.ok, true)
  assert.equal(readFileSync(join(home, 'prompts', 'newone.txt'), 'utf8'), '你是新角色，说话简短。')
  const meta = JSON.parse(readFileSync(join(home, 'persona-hub', 'meta.json'), 'utf8'))
  assert.equal(meta.newone.name, '新角色')
  assert.equal(listPersonas(cfg).find((x) => x.key === 'newone').origin, 'user')
  assert.equal(readPersona(cfg, 'newone').text, '你是新角色，说话简短。')
}))

test('重复 key 拒绝；overwrite 可覆盖', () => withHome((cfg) => {
  assert.equal(importPersona(cfg, { key: 'dup', text: 'a' }).ok, true)
  const again = importPersona(cfg, { key: 'dup', text: 'b' })
  assert.equal(again.ok, false)
  assert.equal(again.error, 'persona_exists')
  assert.equal(importPersona(cfg, { key: 'dup', text: 'b', overwrite: true }).ok, true)
  assert.equal(readPersona(cfg, 'dup').text, 'b')
}))

test('key 白名单/空文本拒绝', () => withHome((cfg) => {
  assert.equal(importPersona(cfg, { key: '../x', text: 'a' }).error, 'invalid_key')
  assert.equal(importPersona(cfg, { key: 'ok', text: '   ' }).error, 'empty_text')
}))

test('删除只删用户副本；出厂角色拒绝', () => withHome((cfg) => {
  assert.equal(isUserPersona(cfg, 'bigfish'), false)
  assert.equal(deletePersona(cfg, 'bigfish').error, 'persona_shipped_immutable')
  importPersona(cfg, { key: 'tmpone', text: 't' })
  assert.equal(deletePersona(cfg, 'tmpone').ok, true)
  assert.equal(existsSync(join(process.env.DSH_HOME || '', 'prompts', 'tmpone.txt')), false)
}))

test('被引用时需 force；usage 能指出 dsh/bots', () => withHome((cfg) => {
  importPersona(cfg, { key: 'used', text: 'u' })
  const config = { dsh: { enabled: true, defaultPersona: 'used' },
    bots: { b1: { private: { enabled: true, defaultPersona: 'used', bindings: {} }, group: { enabled: true, defaultPersona: '', bindings: { g1: 'used' } } } } }
  const usage = findPersonaUsage(config, 'used')
  assert.equal(usage.length, 3)
  const blocked = deletePersona(cfg, 'used', { config })
  assert.equal(blocked.error, 'persona_in_use')
  assert.equal(deletePersona(cfg, 'used', { config, force: true }).ok, true)
}))
