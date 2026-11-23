/**
 * 身份提示补发（R9-08 第 4/5 项）：hook 首次 assemble 幂等补发一次。
 *
 * 锁住：
 *   - section.text 第一次被宿主求值时调用 onFirstAssemble 恰好一次（多次求值不重复）；
 *   - dispose 后不再补发；
 *   - 补发抛错只落日志，不阻断人设注入；
 *   - index.apply 端到端：启动时 A 未挂载 → 首次 assemble 补发一次；启动已发 → 首次 assemble 不重发。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { installPersonaHook } from '../src/host/hook.js'
import { apply, Config } from '../index.js'

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

function withTempHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'persona-boot-'))
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

test('首次 assemble 补发一次：多次求值只调用一次，且人设照常注入', () => {
  const { ctx, state } = fakeCtx()
  let calls = 0
  installPersonaHook(ctx, { config: { dsh: { enabled: true, defaultPersona: 'bigfish' } }, onFirstAssemble: () => { calls += 1 } })
  assert.equal(calls, 0, '安装时不发')
  assert.match(state.section.text({}), /大肥鱼/)
  assert.equal(calls, 1)
  state.section.text({})
  state.section.text({})
  assert.equal(calls, 1, '补发必须幂等（只一次）')
})

test('dispose 后首次求值不补发', () => {
  const { ctx, state } = fakeCtx()
  let calls = 0
  installPersonaHook(ctx, { config: { dsh: { enabled: true, defaultPersona: 'bigfish' } }, onFirstAssemble: () => { calls += 1 } })
  for (const dispose of state.disposers) dispose()
  assert.equal(state.section, null)
  assert.equal(calls, 0, 'disposed 不再发')
})

test('补发抛错只落日志，不阻断注入', () => {
  const { ctx, state } = fakeCtx()
  const lines = []
  installPersonaHook(ctx, {
    config: { dsh: { enabled: true, defaultPersona: 'bigfish' } },
    log: (line) => lines.push(line),
    onFirstAssemble() { throw new Error('whale boom') },
  })
  assert.match(state.section.text({}), /大肥鱼/, '补发失败不得影响人设注入')
  assert.equal(lines.length, 1)
  assert.match(lines[0], /bootstrap failed: whale boom/)
})

/** apply() 用假 ctx：记录 section 与 disposer，鲸忆服务可在启动后挂载（真实时序）。 */
function makeAppCtx({ whaleRef }) {
  const captured = { section: null }
  const disposers = []
  const ctx = {
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return () => {} },
    on: () => () => {},
    provide: () => {},
    get(name) { return name === 'whaleMemory' ? whaleRef.current : undefined },
    webServer: { register: () => () => {} },
    systemPrompt: { section: (s) => { captured.section = s; return () => {} } },
  }
  return { ctx, captured, disposers }
}

function applyConfig(assetsDir) {
  return Config({ dsh: { enabled: true, defaultPersona: 'bigfish' }, bots: {}, assets: { dir: assetsDir, watch: false } })
}

test('apply 端到端：启动时 A 未挂载 → 首次 assemble 补发一次，此后不再发', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'assets')
    mkdirSync(dir, { recursive: true })
    const whaleRef = { current: undefined }
    const sets = []
    const clears = []
    const { ctx, captured } = makeAppCtx({ whaleRef })
    apply(ctx, applyConfig(dir))
    assert.ok(captured.section)

    // A 在 persona-hub 之后挂载（真实时序）：首次 assemble 前服务就绪。
    whaleRef.current = { setIdentityHint(h) { sets.push(h) }, clearIdentityHint() { clears.push(true) } }
    assert.match(captured.section.text({}), /大肥鱼/)
    assert.deepEqual(sets, [{ roleId: '' }], '首次 assemble 必须补发一次（bigfish 显式置空）')
    assert.equal(clears.length, 0)

    captured.section.text({})
    assert.equal(sets.length, 1, '补发只一次，不清不重发')
  })
})

test('apply 端到端：启动时已发 → 首次 assemble 不重发（latch）', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'assets')
    mkdirSync(dir, { recursive: true })
    const sets = []
    const whaleRef = { current: { setIdentityHint(h) { sets.push(h) }, clearIdentityHint() {} } }
    const { ctx, captured } = makeAppCtx({ whaleRef })
    apply(ctx, applyConfig(dir))
    assert.deepEqual(sets, [{ roleId: '' }], '启动即应发一次')
    captured.section.text({})
    assert.equal(sets.length, 1, '启动已发则 assemble 不得重复发')
  })
})

test('apply 端到端：未登记 persona（资产存在但无 role 映射）→ clearIdentityHint', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'assets')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'custom.txt'), '自定义角色', 'utf8')
    const sets = []
    let clears = 0
    const whaleRef = { current: { setIdentityHint(h) { sets.push(h) }, clearIdentityHint() { clears += 1 } } }
    const { ctx, captured } = makeAppCtx({ whaleRef })
    const config = Config({ dsh: { enabled: true, defaultPersona: 'custom' }, bots: {}, assets: { dir, watch: false } })
    apply(ctx, config)
    assert.match(captured.section.text({}), /自定义角色/)
    assert.deepEqual(sets, [], '未知 persona 不得 setIdentityHint({roleId:""})')
    assert.ok(clears >= 1, '未知 persona 必须 clearIdentityHint')
  })
})
