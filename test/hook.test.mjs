import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installPersonaHook } from '../src/host/hook.js'
import { writeActive } from '../src/host/persona-store.js'

function fakeCtx() {
  const state = { section: null }
  const ctx = {
    systemPrompt: { section(def) { state.section = def; return () => {} } },
    effect(fn) { return fn() },
  }
  return { ctx, state }
}

test('默认注入大肥鱼（order=10、不插值）', () => {
  const { ctx, state } = fakeCtx()
  installPersonaHook(ctx, { config: { injectEnabled: true, defaultPersona: 'bigfish' } })
  assert.equal(state.section.order, 10)
  assert.equal(state.section.interpolate, false)
  assert.match(state.section.text({}), /大肥鱼/)
})

test('关闭注入 / subagent 返回空', () => {
  const { ctx, state } = fakeCtx()
  installPersonaHook(ctx, { config: { injectEnabled: false, defaultPersona: 'bigfish' } })
  assert.equal(state.section.text({}), '')
})

test('active 选择覆盖默认角色', () => {
  const home = mkdtempSync(join(tmpdir(), 'dshhome-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    writeActive('aluna')
    const { ctx, state } = fakeCtx()
    installPersonaHook(ctx, { config: { injectEnabled: true, defaultPersona: 'bigfish' } })
    assert.match(state.section.text({}), /阿罗娜/)
  } finally { if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old }
})
