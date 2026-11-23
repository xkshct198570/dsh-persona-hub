/**
 * 身份提示契约（跨包可选服务）：本包必须能独立安装。
 *
 * 锁住：
 *   - 没有 whaleMemory 服务 / 取服务本身抛错 → {sent:false,reason:'no_service'}，不抛；
 *   - bigfish 映射空 roleId，且提示只带 roleId（workspace 由会话 cwd 派生，不在这里写）；
 *   - 未知 persona → null（调用方必须 clearIdentityHint，不得 setIdentityHint({roleId:''})）；
 *   - 重复设同一角色幂等（不累积、不清提示）；空 key / 关闭时清旧提示；
 *   - 服务方法抛异常 fail-open。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyIdentityHint } from '../src/host/routes.js'
import { identityForPersona, PERSONA_ROLE_IDS } from '../src/host/role-map.js'

/** 最小 ctx：只提供鲸忆服务（可选）。 */
function ctxWith(service) {
  return { get: (name) => (name === 'whaleMemory' ? service : undefined) }
}

/** 静默日志：契约测试只看返回值，不污染测试输出。 */
const quiet = () => {}

test('独立安装：无 whaleMemory / 取服务抛错 → no_service 且不抛', () => {
  assert.deepEqual(applyIdentityHint(ctxWith(undefined), 'aluna', { log: quiet }), { sent: false, reason: 'no_service' })
  assert.deepEqual(
    applyIdentityHint({ get() { throw new Error('service unavailable') } }, 'aluna', { log: quiet }),
    { sent: false, reason: 'no_service' },
  )
  assert.deepEqual(applyIdentityHint(undefined, 'aluna', { log: quiet }), { sent: false, reason: 'no_service' })
})

test('role 映射：bigfish→空串，未知 key→null；提示只带 roleId（不写 workspace）', () => {
  assert.deepEqual(PERSONA_ROLE_IDS, { bigfish: '', aluna: 'aluna', yiyi: 'yiyi' })
  assert.deepEqual(identityForPersona('bigfish'), { roleId: '' })
  assert.deepEqual(identityForPersona('aluna'), { roleId: 'aluna' })
  assert.deepEqual(identityForPersona('yiyi'), { roleId: 'yiyi' })
  assert.equal(identityForPersona('unknown-key'), null, '未知 persona 必须 null，不能是 {roleId:""}')
  for (const key of ['bigfish', 'aluna', 'yiyi']) {
    assert.equal(Object.hasOwn(identityForPersona(key), 'workspace'), false, `${key} 不得写 workspace`)
  }
})

test('幂等：重复设同一角色两次，提示值一致且不清旧提示', () => {
  const hints = []
  let clears = 0
  const svc = { setIdentityHint(h) { hints.push(h) }, clearIdentityHint() { clears += 1 } }
  const ctx = ctxWith(svc)
  assert.deepEqual(applyIdentityHint(ctx, 'aluna', { log: quiet }), { sent: true, reason: 'ok' })
  assert.deepEqual(applyIdentityHint(ctx, 'aluna', { log: quiet }), { sent: true, reason: 'ok' })
  assert.deepEqual(hints, [{ roleId: 'aluna' }, { roleId: 'aluna' }])
  assert.equal(clears, 0)
})

test('空 key / 网页端关闭 → 清旧提示、不发新提示', () => {
  const hints = []
  let clears = 0
  const svc = { setIdentityHint(h) { hints.push(h) }, clearIdentityHint() { clears += 1 } }
  const ctx = ctxWith(svc)
  assert.deepEqual(applyIdentityHint(ctx, '', { log: quiet }), { sent: false, reason: 'empty_key' })
  assert.deepEqual(applyIdentityHint(ctx, '   ', { log: quiet }), { sent: false, reason: 'empty_key' })
  assert.deepEqual(applyIdentityHint(ctx, 'aluna', { enabled: false, log: quiet }), { sent: false, reason: 'not_enabled' })
  assert.equal(hints.length, 0)
  assert.equal(clears, 3, '每次关闭/空 key 都必须清一次旧提示')
})

test('未知 persona：clearIdentityHint 而不是 setIdentityHint({roleId:""})（不压手工 roleId）', () => {
  const sets = []
  let clears = 0
  const svc = { setIdentityHint(h) { sets.push(h) }, clearIdentityHint() { clears += 1 } }
  assert.deepEqual(applyIdentityHint(ctxWith(svc), 'custompersona', { log: quiet }), { sent: false, reason: 'unknown_persona' })
  assert.equal(clears, 1, '未知 persona 必须走 clear 分支')
  assert.deepEqual(sets, [], '未知 persona 绝不能 setIdentityHint({roleId:""})')
})

test('bigfish（登记项）：显式置空走 setIdentityHint({roleId:""})，不清提示', () => {
  const sets = []
  let clears = 0
  const svc = { setIdentityHint(h) { sets.push(h) }, clearIdentityHint() { clears += 1 } }
  assert.deepEqual(applyIdentityHint(ctxWith(svc), 'bigfish', { log: quiet }), { sent: true, reason: 'ok' })
  assert.deepEqual(sets, [{ roleId: '' }], 'bigfish 是登记项，保留显式置空语义')
  assert.equal(clears, 0)
})

test('可选服务异常 fail-open：set/clear 抛错都不向外抛', () => {
  const throwing = ctxWith({
    setIdentityHint() { throw new Error('whale set boom') },
    clearIdentityHint() { throw new Error('whale clear boom') },
  })
  assert.deepEqual(applyIdentityHint(throwing, 'aluna', { log: quiet }), { sent: false, reason: 'set_failed' })
  assert.deepEqual(applyIdentityHint(throwing, '', { log: quiet }), { sent: false, reason: 'clear_failed' })
})

test('旧服务只实现 clearIdentityHint：空 key 可清，设提示回 no_method', () => {
  let clears = 0
  const ctx = ctxWith({ clearIdentityHint() { clears += 1 } })
  assert.deepEqual(applyIdentityHint(ctx, '', { log: quiet }), { sent: false, reason: 'empty_key' })
  assert.equal(clears, 1)
  assert.deepEqual(applyIdentityHint(ctx, 'aluna', { log: quiet }), { sent: false, reason: 'no_method' },
    '没有 setIdentityHint 时不得假装已发送')
})

test('非对象提示不被当成服务：字符串/函数 → no_service/no_method', () => {
  assert.deepEqual(applyIdentityHint(ctxWith('whale'), 'aluna', { log: quiet }), { sent: false, reason: 'no_service' })
  // 函数对象可以带方法，但这里没有 setIdentityHint → no_method，而不是崩。
  assert.deepEqual(applyIdentityHint(ctxWith(() => {}), 'aluna', { log: quiet }), { sent: false, reason: 'no_method' })
})

test('落日志：每次决策都有 reason 行（不再静默返回 boolean）', () => {
  const lines = []
  const svc = { setIdentityHint() {}, clearIdentityHint() {} }
  applyIdentityHint(ctxWith(svc), 'aluna', { log: (line) => lines.push(line) })
  applyIdentityHint(ctxWith(svc), '', { log: (line) => lines.push(line) })
  assert.equal(lines.length, 2)
  assert.match(lines[0], /reason|sent|role=aluna/)
  assert.match(lines[1], /cleared: empty_key/)
})
