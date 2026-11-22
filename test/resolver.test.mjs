/**
 * resolvePersona 路由单测（C 包契约）。
 *
 * 全程用 fake store + 内存 config，不写磁盘、不读真实资产：
 *   - dsh 分支：config.dsh.enabled + defaultPersona
 *   - 平台分支：bots[bot_id].enabled → bot[chat_type].enabled → bindings[target_id] || defaultPersona
 *   - 任一层降级 → null；返回 { personaKey, name, avatar, text }
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createResolver } from '../src/host/resolver.js'

const PERSONAS = {
  bigfish: { ok: true, key: 'bigfish', text: '我是大肥鱼', meta: { name: '大肥鱼', avatar: 'bigfish.png' }, mtime: 1700000000000 },
  aluna: { ok: true, key: 'aluna', text: '我是阿罗娜', meta: { name: '阿罗娜', avatar: 'aluna.png' }, mtime: 1700000000001 },
  yiyi: { ok: true, key: 'yiyi', text: '我是一叶', meta: { name: '一叶', avatar: 'yiyi.png' }, mtime: 1700000000002 },
}

/** fake store：按 key 命中 PERSONAS / 指定 failures / 整表抛错，并记录调用参数。 */
function makeStore({ assets = PERSONAS, failures = {}, throws = false } = {}) {
  const calls = []
  return {
    calls,
    readPersona(cfg, key) {
      calls.push({ cfg, key })
      if (throws) throw new Error('store boom')
      if (Object.hasOwn(failures, key)) return failures[key]
      const hit = assets[key]
      if (!hit) return { ok: false, error: `missing asset: ${key}` }
      return hit
    },
  }
}

/** 内存 config：两个 bot（qq / telegram 自定义平台名），各带 private/group 通道与特例绑定。 */
function makeConfig(mutate) {
  const cfg = {
    dsh: { enabled: true, defaultPersona: 'bigfish' },
    bots: {
      '10001': {
        enabled: true,
        platform: 'qq',
        private: { enabled: true, defaultPersona: 'aluna', bindings: { '20002': 'yiyi' } },
        group: { enabled: true, defaultPersona: 'yiyi', bindings: { '30003': 'bigfish' } },
      },
      '90001': {
        enabled: true,
        platform: 'telegram',
        private: { enabled: true, defaultPersona: 'aluna', bindings: { 'tg-1': 'bigfish' } },
        group: { enabled: true, defaultPersona: 'yiyi', bindings: {} },
      },
    },
  }
  if (mutate) mutate(cfg)
  return cfg
}

function resolverFor({ config = makeConfig(), store = makeStore() } = {}) {
  return createResolver({ config, store })
}

// 1 · dsh 默认命中：完整返回结构，且不依赖 bot_id/chat_type
test('dsh 默认命中：返回 personaKey/name/avatar/text', () => {
  const resolve = resolverFor()
  const got = resolve({ source: 'dsh', bot_id: '10001', chat_type: 'group', target_id: '30003' })
  assert.deepEqual(got, {
    personaKey: 'bigfish',
    name: '大肥鱼',
    avatar: 'bigfish.png',
    text: '我是大肥鱼',
  })
})

// 2 · dsh disabled → null
test('dsh disabled → null', () => {
  const resolve = resolverFor({ config: makeConfig((c) => { c.dsh.enabled = false }) })
  assert.equal(resolve({ source: 'dsh' }), null)
})

// 3 · dsh 未配 key（空字符串）→ null，且不读 store
test('dsh defaultPersona 为空 → null（不读资产）', () => {
  const store = makeStore()
  const resolve = resolverFor({ config: makeConfig((c) => { c.dsh.defaultPersona = '' }), store })
  assert.equal(resolve({ source: 'dsh' }), null)
  assert.deepEqual(store.calls, [])
})

// 4 · dsh 指向资产缺失 → null（store ok:false）
test('dsh 默认角色资产缺失 → null', () => {
  const resolve = resolverFor({ config: makeConfig((c) => { c.dsh.defaultPersona = 'ghost' }) })
  assert.equal(resolve({ source: 'dsh' }), null)
})

// 5 · 未知 bot_id → null
test('未知 bot_id → null', () => {
  const resolve = resolverFor()
  assert.equal(resolve({ source: 'qq', bot_id: '404', chat_type: 'private', target_id: '20002' }), null)
})

// 6 · bot disabled → null
test('bot disabled → null（通道再开也不放行）', () => {
  const resolve = resolverFor({ config: makeConfig((c) => { c.bots['10001'].enabled = false }) })
  assert.equal(resolve({ source: 'qq', bot_id: '10001', chat_type: 'private', target_id: '20002' }), null)
})

// 7 · private 通道 disabled → null
test('private 通道 disabled → null', () => {
  const resolve = resolverFor({ config: makeConfig((c) => { c.bots['10001'].private.enabled = false }) })
  assert.equal(resolve({ source: 'qq', bot_id: '10001', chat_type: 'private', target_id: '20002' }), null)
})

// 8 · private binding 命中特例
test('private binding 命中特例 → yiyi', () => {
  const resolve = resolverFor()
  assert.deepEqual(resolve({ source: 'qq', bot_id: '10001', chat_type: 'private', target_id: '20002' }), {
    personaKey: 'yiyi',
    name: '一叶',
    avatar: 'yiyi.png',
    text: '我是一叶',
  })
})

// 9 · private binding 未命中 → 通道 defaultPersona
test('private binding 未命中 → 回落到 defaultPersona(aluna)', () => {
  const resolve = resolverFor()
  const got = resolve({ source: 'qq', bot_id: '10001', chat_type: 'private', target_id: '99999' })
  assert.equal(got.personaKey, 'aluna')
  assert.equal(got.name, '阿罗娜')
  assert.equal(got.text, '我是阿罗娜')
})

// 10 · group binding 命中特例
test('group binding 命中特例 → bigfish', () => {
  const resolve = resolverFor()
  assert.deepEqual(resolve({ source: 'qq', bot_id: '10001', chat_type: 'group', target_id: '30003' }), {
    personaKey: 'bigfish',
    name: '大肥鱼',
    avatar: 'bigfish.png',
    text: '我是大肥鱼',
  })
})

// 11 · group binding 未命中 → 通道 defaultPersona
test('group binding 未命中 → 回落到 defaultPersona(yiyi)', () => {
  const resolve = resolverFor()
  const got = resolve({ source: 'qq', bot_id: '10001', chat_type: 'group', target_id: '99999' })
  assert.equal(got.personaKey, 'yiyi')
  assert.equal(got.name, '一叶')
})

// 12 · group 通道 disabled → null
test('group 通道 disabled → null', () => {
  const resolve = resolverFor({ config: makeConfig((c) => { c.bots['10001'].group.enabled = false }) })
  assert.equal(resolve({ source: 'qq', bot_id: '10001', chat_type: 'group', target_id: '30003' }), null)
})

// 13 · chat_type 非法 → null
test('chat_type 非法（channel）→ null', () => {
  const resolve = resolverFor()
  assert.equal(resolve({ source: 'qq', bot_id: '10001', chat_type: 'channel', target_id: '20002' }), null)
})

// 14 · target_id 空字符串 → 走 default
test('target_id 为空字符串 → 跳过 binding 走 default', () => {
  const resolve = resolverFor()
  const got = resolve({ source: 'qq', bot_id: '10001', chat_type: 'private', target_id: '' })
  assert.equal(got.personaKey, 'aluna')
})

// 15 · target_id 未传 → 走 default
test('target_id 未传 → 走 default', () => {
  const resolve = resolverFor()
  assert.equal(resolve({ source: 'qq', bot_id: '10001', chat_type: 'group' }).personaKey, 'yiyi')
})

// 16 · 自定义平台名（telegram，非 qq）同规则可用
test('自定义平台名 telegram 同规则可用（binding 命中 + default 回落）', () => {
  const resolve = resolverFor()
  assert.equal(resolve({ source: 'telegram', bot_id: '90001', chat_type: 'private', target_id: 'tg-1' }).personaKey, 'bigfish')
  assert.equal(resolve({ source: 'telegram', bot_id: '90001', chat_type: 'private', target_id: 'tg-2' }).personaKey, 'aluna')
  assert.equal(resolve({ source: 'telegram', bot_id: '90001', chat_type: 'group', target_id: 'x' }).personaKey, 'yiyi')
})

// 17 · 绑定 key 资产缺失 → null
test('binding 指向的资产缺失 → null', () => {
  const resolve = resolverFor({ config: makeConfig((c) => { c.bots['10001'].private.bindings['20002'] = 'ghost' }) })
  assert.equal(resolve({ source: 'qq', bot_id: '10001', chat_type: 'private', target_id: '20002' }), null)
})

// 18 · store 明确返回 ok:false（带 error）→ null
test('store 返回 ok:false + error → null', () => {
  const store = makeStore({ failures: { aluna: { ok: false, error: 'EACCES' } } })
  const resolve = resolverFor({ store })
  assert.equal(resolve({ source: 'qq', bot_id: '10001', chat_type: 'private', target_id: '99999' }), null)
})

// 19 · store 抛异常 → null（绝不向外抛）
test('store 抛异常 → null 且不抛出', () => {
  const resolve = resolverFor({ store: makeStore({ throws: true }) })
  assert.equal(resolve({ source: 'qq', bot_id: '10001', chat_type: 'private', target_id: '20002' }), null)
})

// 20 · meta 缺失时 name=personaKey、avatar=''
test('meta 缺失 → name=personaKey、avatar=空串', () => {
  const store = makeStore({ assets: { bigfish: { ok: true, key: 'bigfish', text: '裸文本', mtime: 1 } } })
  const resolve = resolverFor({ store })
  assert.deepEqual(resolve({ source: 'dsh' }), {
    personaKey: 'bigfish',
    name: 'bigfish',
    avatar: '',
    text: '裸文本',
  })
})

// 21 · source 为空 → null
test('source 为空 → null', () => {
  const resolve = resolverFor()
  assert.equal(resolve({}), null)
  assert.equal(resolve({ source: '' }), null)
})

// 22 · store.readPersona 收到 (config, key)，key 已规范化
test('store.readPersona 以 (config, key) 调用', () => {
  const config = makeConfig()
  const store = makeStore()
  const resolve = createResolver({ config, store })
  resolve({ source: 'qq', bot_id: '10001', chat_type: 'private', target_id: '20002' })
  assert.equal(store.calls.length, 1)
  assert.equal(store.calls[0].cfg, config)
  assert.equal(store.calls[0].key, 'yiyi')
})

// ---- 2026-11-22 补：enabled 语义与 Python 网关对齐（只有显式 false/0/'' 才关闭） ----

test('enabled 缺省＝开启：dsh/bot/channel 三处 undefined 都照常解析', () => {
  const config = makeConfig((cfg) => {
    delete cfg.dsh.enabled
    delete cfg.bots['10001'].enabled
    delete cfg.bots['10001'].private.enabled
  })
  const resolve = resolverFor({ config })
  assert.equal(resolve({ source: 'dsh' }).personaKey, 'bigfish')
  assert.equal(resolve({ source: 'qq', bot_id: '10001', chat_type: 'private' }).personaKey, 'aluna')
})

test('enabled 显式 false/0/空串都算关闭（镜像文件手工编辑场景）', () => {
  for (const off of [false, 0, '']) {
    const config = makeConfig((cfg) => { cfg.dsh.enabled = off })
    assert.equal(resolverFor({ config })({ source: 'dsh' }), null, `dsh.enabled=${JSON.stringify(off)} 应关闭`)
    const botCfg = makeConfig((cfg) => { cfg.bots['10001'].enabled = off })
    assert.equal(resolverFor({ config: botCfg })({ source: 'qq', bot_id: '10001', chat_type: 'private' }), null)
    const chanCfg = makeConfig((cfg) => { cfg.bots['10001'].private.enabled = off })
    assert.equal(resolverFor({ config: chanCfg })({ source: 'qq', bot_id: '10001', chat_type: 'private' }), null)
  }
})

test('explain 的 11 个降级 reason 码逐条可断言（§18.7）', () => {
  const base = makeConfig()
  const cases = [
    [{ source: '' }, 'source_missing'],
    [{ source: 'qq', chat_type: 'private' }, 'bot_id_required'],
    [{ source: 'qq', bot_id: 'nope', chat_type: 'private' }, 'bot_unknown'],
    [{ source: 'qq', bot_id: '10001', chat_type: 'ch' }, 'chat_type_invalid'],
    [{ source: 'telegram', bot_id: '10001', chat_type: 'private' }, 'platform_mismatch'],
  ]
  for (const [q, reason] of cases) {
    assert.equal(createResolver({ config: base, store: makeStore() }).explain(q).reason, reason, JSON.stringify(q))
  }
  const offDsh = makeConfig((cfg) => { cfg.dsh.enabled = false })
  assert.equal(createResolver({ config: offDsh, store: makeStore() }).explain({ source: 'dsh' }).reason, 'dsh_disabled')
  const unsetDsh = makeConfig((cfg) => { cfg.dsh.defaultPersona = '' })
  assert.equal(createResolver({ config: unsetDsh, store: makeStore() }).explain({ source: 'dsh' }).reason, 'default_persona_unset')
  const noAsset = makeConfig((cfg) => { cfg.dsh.defaultPersona = 'ghost' })
  assert.equal(createResolver({ config: noAsset, store: makeStore() }).explain({ source: 'dsh' }).reason, 'persona_asset_missing')
  const offBot = makeConfig((cfg) => { cfg.bots['10001'].enabled = false })
  assert.equal(createResolver({ config: offBot, store: makeStore() }).explain({ source: 'qq', bot_id: '10001', chat_type: 'private' }).reason, 'bot_disabled')
  const offChannel = makeConfig((cfg) => { cfg.bots['10001'].private.enabled = false })
  assert.equal(createResolver({ config: offChannel, store: makeStore() }).explain({ source: 'qq', bot_id: '10001', chat_type: 'private' }).reason, 'chat_type_disabled')
  const unsetChannel = makeConfig((cfg) => { cfg.bots['10001'].private.defaultPersona = '' })
  assert.equal(createResolver({ config: unsetChannel, store: makeStore() }).explain({ source: 'qq', bot_id: '10001', chat_type: 'private' }).reason, 'default_persona_unset')
  const throwing = createResolver({ config: base, store: makeStore({ throws: true }) })
  assert.equal(throwing.explain({ source: 'dsh' }).reason, 'resolve_error')
})
