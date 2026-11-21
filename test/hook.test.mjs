import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installPersonaHook } from '../src/host/hook.js'

function fakeCtx() {
  const state = { section: null }
  const ctx = { systemPrompt: { section(def) { state.section = def; return () => {} } }, effect(fn) { return fn() } }
  return { ctx, state }
}

test('默认注入大肥鱼（order=10、不插值）', () => {
  const { ctx, state } = fakeCtx()
  installPersonaHook(ctx, { config: { dsh: { enabled: true, defaultPersona: 'bigfish' } } })
  assert.equal(state.section.order, 10)
  assert.equal(state.section.interpolate, false)
  assert.match(state.section.text({}), /大肥鱼/)
})

test('dsh.enabled=false 返回空', () => {
  const { ctx, state } = fakeCtx()
  installPersonaHook(ctx, { config: { dsh: { enabled: false, defaultPersona: 'bigfish' } } })
  assert.equal(state.section.text({}), '')
})

test('subagent 返回空', () => {
  const { ctx, state } = fakeCtx()
  installPersonaHook(ctx, { config: { dsh: { enabled: true, defaultPersona: 'bigfish' } } })
  assert.equal(state.section.text({ agent: { session: { header: { origin: 'subagent' } } } }), '')
})

test('config.dsh.defaultPersona 切换即换文本', () => {
  const home = mkdtempSync(join(tmpdir(), 'dshhome-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    mkdirSync(join(home, 'persona-hub', 'prompts'), { recursive: true })
    writeFileSync(join(home, 'persona-hub', 'prompts', 'aluna.txt'), '你是阿罗娜（测试）', 'utf8')
    const { ctx, state } = fakeCtx()
    const config = { dsh: { enabled: true, defaultPersona: 'aluna' } }
    const hook = installPersonaHook(ctx, { config })
    assert.match(state.section.text({}), /阿罗娜/)
    config.dsh.defaultPersona = 'bigfish'
    hook.refresh()
    assert.match(state.section.text({}), /大肥鱼/)
  } finally { if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old }
})

test('用户目录资产覆盖出厂', () => {
  const home = mkdtempSync(join(tmpdir(), 'dshhome-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    mkdirSync(join(home, 'persona-hub', 'prompts'), { recursive: true })
    writeFileSync(join(home, 'persona-hub', 'prompts', 'bigfish.txt'), '自定义大肥鱼', 'utf8')
    const { ctx, state } = fakeCtx()
    installPersonaHook(ctx, { config: { dsh: { enabled: true, defaultPersona: 'bigfish' } } })
    assert.equal(state.section.text({}), '自定义大肥鱼')
  } finally { if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old }
})
