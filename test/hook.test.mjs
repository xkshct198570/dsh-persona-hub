import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { installPersonaHook } from '../src/host/hook.js'

/**
 * 假 ctx：只实现 hook 真正调用的面。
 * subagent 信号走真实 API（`ctx.get('agents').currentInitiator()` → Agent.session.header.origin），
 * 不再喂 `context.agent.session.header` 这种真机不存在的形状。
 */
function fakeCtx({ origin } = {}) {
  const state = { section: null, disposers: [] }
  const ctx = {
    systemPrompt: {
      section(def) {
        state.section = def
        return () => { if (state.section === def) state.section = null }
      },
    },
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') state.disposers.push(d)
      return d
    },
    get(name) {
      if (name !== 'agents') return undefined
      return { currentInitiator: () => ({ session: { header: { origin } } }) }
    },
  }
  return { ctx, state }
}

async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'dshhook-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    // 必须 await：async 回调里 cleanup 不能抢在正文执行前跑。
    return await fn(home)
  } finally {
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
    rmSync(home, { recursive: true, force: true })
  }
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

test('dsh.enabled 缺省＝开启（与 resolver/网关同口径）', () => {
  const { ctx, state } = fakeCtx()
  installPersonaHook(ctx, { config: { dsh: { defaultPersona: 'bigfish' } } })
  assert.match(state.section.text({}), /大肥鱼/)
})

test('subagent 会话（AgentsService.currentInitiator origin=subagent）返回空', () => {
  const { ctx, state } = fakeCtx({ origin: 'subagent' })
  installPersonaHook(ctx, { config: { dsh: { enabled: true, defaultPersona: 'bigfish' } } })
  assert.equal(state.section.text({}), '')
})

test('普通会话即使 context 带假 agent.session.header 也照常注入', () => {
  const { ctx, state } = fakeCtx({ origin: 'main' })
  installPersonaHook(ctx, { config: { dsh: { enabled: true, defaultPersona: 'bigfish' } } })
  // AssembleContext 真机只有 {scope,signal}；旧分支读 context.agent 永远 undefined，已删。
  assert.match(state.section.text({ agent: { session: { header: { origin: 'subagent' } } } }), /大肥鱼/)
})

test('config.dsh.defaultPersona 切换即换文本', () => {
  return withHome((home) => {
    mkdirSync(join(home, 'persona-hub', 'prompts'), { recursive: true })
    writeFileSync(join(home, 'persona-hub', 'prompts', 'aluna.txt'), '你是阿罗娜（测试）', 'utf8')
    const { ctx, state } = fakeCtx()
    const config = { dsh: { enabled: true, defaultPersona: 'aluna' } }
    const hook = installPersonaHook(ctx, { config })
    assert.match(state.section.text({}), /阿罗娜/)
    config.dsh.defaultPersona = 'bigfish'
    hook.refresh()
    assert.match(state.section.text({}), /大肥鱼/)
  })
})

test('用户目录资产覆盖出厂', () => {
  return withHome((home) => {
    mkdirSync(join(home, 'persona-hub', 'prompts'), { recursive: true })
    writeFileSync(join(home, 'persona-hub', 'prompts', 'bigfish.txt'), '自定义大肥鱼', 'utf8')
    const { ctx, state } = fakeCtx()
    installPersonaHook(ctx, { config: { dsh: { enabled: true, defaultPersona: 'bigfish' } } })
    assert.equal(state.section.text({}), '自定义大肥鱼')
  })
})

test('空 defaultPersona 不回退出厂 bigfish（返回空串）', () => {
  const { ctx, state } = fakeCtx()
  installPersonaHook(ctx, { config: { dsh: { enabled: true, defaultPersona: '' } } })
  assert.equal(state.section.text({}), '', '空 key 必须与 resolver 的 default_persona_unset 同口径')
})

test('读失败保留旧快照；从未成功读过才空串', async () => {
  await withHome(async (home) => {
    const dir = join(home, 'persona-hub', 'prompts')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'aluna.txt')
    writeFileSync(file, '阿罗娜旧快照', 'utf8')
    const { ctx, state } = fakeCtx()
    // 测试注入短 TTL，避免真的等 2s。
    installPersonaHook(ctx, { config: { dsh: { enabled: true, defaultPersona: 'aluna' } }, cacheTtlMs: 40 })
    assert.equal(state.section.text({}), '阿罗娜旧快照')

    await sleep(60) // 缓存已过期，下一次求值会真的去读
    rmSync(file)
    mkdirSync(file) // 同名目录：readPersona 返回 persona_unreadable
    assert.equal(state.section.text({}), '阿罗娜旧快照', '读失败必须续期返回上次正文，而不是空串')

    const fresh = fakeCtx()
    installPersonaHook(fresh.ctx, { config: { dsh: { enabled: true, defaultPersona: 'aluna' } } })
    assert.equal(fresh.state.section.text({}), '', '无缓存时读失败才返回空串')
  })
})

test('dispose 由 ctx.effect 接管：注销后返回空串', () => {
  const { ctx, state } = fakeCtx()
  installPersonaHook(ctx, { config: { dsh: { enabled: true, defaultPersona: 'bigfish' } } })
  assert.match(state.section.text({}), /大肥鱼/)
  for (const dispose of state.disposers) dispose()
  assert.equal(state.section, null, 'section 应被注销')
  assert.equal(state.disposers.length, 1)
})
