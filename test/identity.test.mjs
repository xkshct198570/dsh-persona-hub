/**
 * 身份提示契约（跨包可选服务）：本包必须能独立安装。
 *
 * 锁住：
 *   - 没有 whaleMemory 服务 / 取服务本身抛错 → 静默 false，不阻断保存与启动；
 *   - bigfish 映射空 roleId，且提示只带 roleId（workspace 由会话 cwd 派生，不在这里写）；
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

test('独立安装：无 whaleMemory / 取服务抛错 → false 且不抛', () => {
  assert.equal(applyIdentityHint(ctxWith(undefined), 'aluna'), false)
  assert.equal(applyIdentityHint({ get() { throw new Error('service unavailable') } }, 'aluna'), false)
  assert.equal(applyIdentityHint(undefined, 'aluna'), false)
})

test('role 映射：bigfish→空串，未知 key→空串；提示只带 roleId（不写 workspace）', () => {
  assert.deepEqual(PERSONA_ROLE_IDS, { bigfish: '', aluna: 'aluna', yiyi: 'yiyi' })
  assert.deepEqual(identityForPersona('bigfish'), { roleId: '' })
  assert.deepEqual(identityForPersona('aluna'), { roleId: 'aluna' })
  assert.deepEqual(identityForPersona('yiyi'), { roleId: 'yiyi' })
  assert.deepEqual(identityForPersona('unknown-key'), { roleId: '' })
  for (const key of ['bigfish', 'aluna', 'yiyi']) {
    assert.equal(Object.hasOwn(identityForPersona(key), 'workspace'), false, `${key} 不得写 workspace`)
  }
})

test('幂等：重复设同一角色两次，提示值一致且不清旧提示', () => {
  const hints = []
  let clears = 0
  const svc = { setIdentityHint(h) { hints.push(h) }, clearIdentityHint() { clears += 1 } }
  const ctx = ctxWith(svc)
  assert.equal(applyIdentityHint(ctx, 'aluna'), true)
  assert.equal(applyIdentityHint(ctx, 'aluna'), true)
  assert.deepEqual(hints, [{ roleId: 'aluna' }, { roleId: 'aluna' }])
  assert.equal(clears, 0)
})

test('空 key / 网页端关闭 → 清旧提示、不发新提示', () => {
  const hints = []
  let clears = 0
  const svc = { setIdentityHint(h) { hints.push(h) }, clearIdentityHint() { clears += 1 } }
  const ctx = ctxWith(svc)
  assert.equal(applyIdentityHint(ctx, ''), false)
  assert.equal(applyIdentityHint(ctx, '   '), false)
  assert.equal(applyIdentityHint(ctx, 'aluna', { enabled: false }), false)
  assert.equal(hints.length, 0)
  assert.equal(clears, 3, '每次关闭/空 key 都必须清一次旧提示')
})

test('可选服务异常 fail-open：set/clear 抛错都不向外抛', () => {
  const throwing = ctxWith({
    setIdentityHint() { throw new Error('whale set boom') },
    clearIdentityHint() { throw new Error('whale clear boom') },
  })
  assert.equal(applyIdentityHint(throwing, 'aluna'), false)
  assert.equal(applyIdentityHint(throwing, ''), false)
})

test('旧服务只实现 clearIdentityHint：空 key 可清，设提示返回 false', () => {
  let clears = 0
  const ctx = ctxWith({ clearIdentityHint() { clears += 1 } })
  assert.equal(applyIdentityHint(ctx, ''), false)
  assert.equal(clears, 1)
  assert.equal(applyIdentityHint(ctx, 'bigfish'), false, '没有 setIdentityHint 时不得假装已发送')
})

test('非对象提示不被当成服务：字符串/函数 → false', () => {
  assert.equal(applyIdentityHint(ctxWith('whale'), 'aluna'), false)
  assert.equal(applyIdentityHint(ctxWith(() => {}), 'aluna'), false)
})
