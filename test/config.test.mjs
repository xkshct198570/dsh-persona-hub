/**
 * Config schema 校验（§12.4.1）：bot_id 放行 QQ 数字号、platform 保留字、bindings 值 key 形态、
 * panel 数值边界；缺省值必须保持历史行为（enabled=true / platform=qq / assets 默认）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../src/host/config.js'

test('bot_id：QQ 数字号与 . _ : - 均合法，空格/斜杠/超长拒绝', () => {
  const ok = Config({
    bots: {
      '1127704268': { private: {}, group: {} },
      'a.b_c:d-1': { platform: 'telegram', private: {}, group: {} },
    },
  })
  assert.deepEqual(Object.keys(ok.bots).sort(), ['1127704268', 'a.b_c:d-1'])
  assert.equal(ok.bots['a.b_c:d-1'].platform, 'telegram')

  for (const badId of ['bad id', 'a/b', 'x'.repeat(129), '中文']) {
    assert.throws(() => Config({ bots: { [badId]: { platform: 'qq', private: {}, group: {} } } }), /bots/, badId)
  }
})

test('platform：非空且不能是保留字 dsh（大小写不敏感）', () => {
  for (const badPlatform of ['', '  ', 'dsh', 'DSH']) {
    assert.throws(() => Config({ bots: { '10001': { platform: badPlatform, private: {}, group: {} } } }), /platform/, JSON.stringify(badPlatform))
  }
  assert.equal(Config({ bots: { '10001': { platform: 'QQ', private: {}, group: {} } } }).bots['10001'].platform, 'QQ')
})

test('bindings 的值必须是 persona key 形态（空串/大写/路径一律拒绝）', () => {
  for (const badKey of ['', 'Bad Key', '../x', 'A']) {
    assert.throws(() => Config({
      bots: { '10001': { private: { bindings: { '20002': badKey } }, group: {} } },
    }), /bindings/, JSON.stringify(badKey))
  }
  const ok = Config({ bots: { '10001': { private: { bindings: { '20002': 'aluna' } }, group: {} } } })
  assert.equal(ok.bots['10001'].private.bindings['20002'], 'aluna')
})

test('缺省值：enabled=true、platform=qq、assets.dir=""、watch=true、panel 三字段默认', () => {
  const cfg = Config({})
  assert.equal(cfg.dsh.enabled, true)
  assert.equal(cfg.dsh.defaultPersona, 'bigfish')
  assert.deepEqual(cfg.bots, {})
  assert.equal(cfg.assets.dir, '')
  assert.equal(cfg.assets.watch.get(), true, '.volatile() assets.watch 是 Ref')
  assert.equal(cfg.panel.allowRemote.get(), false)
  assert.equal(cfg.panel.pollMs.get(), 60000)
  assert.equal(cfg.panel.tab.get(), 'personas')
})

test('panel：pollMs 5000–600000、tab 三选一', () => {
  assert.throws(() => Config({ panel: { pollMs: 4999 } }), /pollMs/)
  assert.throws(() => Config({ panel: { pollMs: 600001 } }), /pollMs/)
  assert.throws(() => Config({ panel: { tab: 'settings' } }), /tab/)
  assert.equal(Config({ panel: { pollMs: 5000 } }).panel.pollMs.get(), 5000)
  assert.equal(Config({ panel: { tab: 'debug' } }).panel.tab.get(), 'debug')
})
