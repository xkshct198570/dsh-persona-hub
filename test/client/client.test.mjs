/**
 * 面板契约测试（零依赖、零网络）：不启动插件、不连后端。
 *
 * 锁住：三页签、设置卡 5 字段（场景/默认/生效）、重新加载入口、危险动作二次确认、
 * 空/错/只读态、i18n 单一真源（标记块 + 全键覆盖）、panel.pollMs/tab 真消费，
 * 以及 `test:pure` 标记块里的纯逻辑（normalizeConfig / missingRefs / reasonText / 校验 / 选项文案）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')
const LANGS = ['zh', 'en']

function flatten(node, prefix = '') {
  const out = {}
  for (const [key, value] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(out, flatten(value, dotted))
    else out[dotted] = value
  }
  return out
}
function locale(lang) {
  return flatten(JSON.parse(fs.readFileSync(path.join(ROOT, 'locale', `${lang}.json`), 'utf8')))
}
const dicts = Object.fromEntries(LANGS.map((lang) => [lang, locale(lang)]))
const tEn = (key, vars) => {
  const raw = dicts.en[key] ?? key
  return String(raw).replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name) => (vars && vars[name] != null ? String(vars[name]) : `{${name}}`))
}
const tZh = (key, vars) => {
  const raw = dicts.zh[key] ?? key
  return String(raw).replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name) => (vars && vars[name] != null ? String(vars[name]) : `{${name}}`))
}

const PURE_START = '// >>> test:pure'
const PURE_END = '// <<< test:pure'
function pure() {
  const start = CLIENT.indexOf(PURE_START)
  const end = CLIENT.indexOf(PURE_END)
  assert.ok(start >= 0 && end > start, '缺少 test:pure 标记块')
  // 跳过整行注释（标记自带中文说明），只取标记之间的代码。
  const bodyStart = CLIENT.indexOf('\n', start) + 1
  const body = CLIENT.slice(bodyStart, end)
  const prelude = `const KEY_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const BOT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const TABS = [['personas','page.tabPersonas'],['bots','page.tabBots'],['debug','page.tabDebug']];`
  const names = ['enabledValue', 'normalizeConfig', 'normalizeChannel', 'normalizeBot', 'normalizeAssets',
    'normalizePanel', 'personaOptions', 'referencedKeys', 'missingRefs', 'reasonText', 'validateConfig']
  return new Function(`${prelude}${body}; return { ${names.join(', ')} };`)()
}

test('三页签 id 与 locale 标签齐全（personas/bots/debug）', () => {
  for (const id of ['personas', 'bots', 'debug']) {
    assert.match(CLIENT, new RegExp(`\\['${id}', 'page\\.tab`), `缺少页签 ${id}`)
  }
  for (const key of ['page.tabPersonas', 'page.tabBots', 'page.tabDebug']) {
    assert.ok(dicts.zh[key] && dicts.en[key], `缺 i18n 键 ${key}`)
  }
})

test('locale 单一真源：zh/en 键集一致、无空值、占位符一致', () => {
  assert.deepEqual([...Object.keys(dicts.en)].sort(), [...Object.keys(dicts.zh)].sort())
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(dicts[lang])) {
      assert.equal(typeof value, 'string', `${lang}.${key} 非字符串`)
      assert.ok(value.trim() !== '', `${lang}.${key} 为空`)
    }
  }
  const placeholders = (s) => [...String(s).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort().join(',')
  for (const key of Object.keys(dicts.zh)) {
    assert.equal(placeholders(dicts.en[key]), placeholders(dicts.zh[key]), `${key} 占位符不一致`)
  }
})

test('client 标记块与 locale JSON 逐字一致；不再内联旧字典', () => {
  const START = '// >>> locale:generated（由 scripts/i18n-check.mjs --write 生成，勿手改）'
  const END = '// <<< locale:generated'
  const json = JSON.stringify(dicts, null, 2).replace(/\n/g, '\n    ')
  const expected = `${START}\n    const dict = ${json}\n    ${END}`
  assert.ok(CLIENT.includes(START), '缺少生成块起始标记')
  assert.ok(CLIENT.includes(END), '缺少生成块结束标记')
  assert.ok(CLIENT.includes(expected), '标记块与 locale JSON 不一致；运行 node scripts/i18n-check.mjs --write')
  assert.doesNotMatch(CLIENT, /^\s*const (zh|en) = \{/m, '旧的 zh/en 内联字典仍然存在')
})

test('面板用到的静态 t(\'...\') 键全部存在于 locale', () => {
  const used = [...CLIENT.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)].map((m) => m[1])
  const missing = [...new Set(used)].filter((key) => !dicts.zh[key])
  assert.deepEqual(missing, [], `缺少 i18n 键：${missing.join(', ')}`)
})

test('设置卡：5 个字段 + 场景/默认/生效 + POST 带 assets/panel', () => {
  for (const key of ['settings.dirDesc', 'settings.watchDesc', 'settings.allowRemoteDesc',
    'settings.pollMsDesc', 'settings.tabDesc']) {
    assert.ok(CLIENT.includes(`t('${key}')`), `设置卡缺少场景句 ${key}`)
  }
  assert.ok(CLIENT.includes("t('settings.defaultLabel')"), '缺少「默认」标注')
  assert.ok(CLIENT.includes("t('settings.effectLabel')"), '缺少「生效」标注')
  assert.ok(CLIENT.includes("t('settings.effectReload')") && CLIENT.includes("t('settings.effectInstant')"), '生效语义缺失')
  assert.match(CLIENT, /config: \{ dsh: target\.dsh, bots: target\.bots, assets: target\.assets, panel: target\.panel \}/,
    'POST /config 必须提交 assets/panel')
})

test('危险动作二次确认：设为 DSH 默认、删除主体', () => {
  const setDefault = CLIENT.slice(CLIENT.indexOf('async function setDshDefault'), CLIENT.indexOf('async function reloadAssets'))
  assert.match(setDefault, /window\.confirm\(t\('dsh\.confirmSetDefault'/, '切角色必须先确认')
  assert.match(setDefault, /\/select/, '设为默认应走 /select')
  const delBot = CLIENT.slice(CLIENT.indexOf('function deleteBot'), CLIENT.indexOf('function addBot'))
  assert.match(delBot, /window\.confirm\(t\('bots\.deleteConfirm'/, '删除主体必须先确认')
})

test('重新加载入口：POST /reload → 再刷资产/预览', () => {
  const fn = CLIENT.slice(CLIENT.indexOf('async function reloadAssets'), CLIENT.indexOf('async function openPreview'))
  assert.match(fn, /postJson\(`\$\{API\}\/reload`/)
  assert.match(fn, /await refreshAssets\(\)/)
  assert.match(CLIENT, /t\('act\.reload'\)/)
  assert.ok(dicts.zh['page.reloaded'] && dicts.en['page.reloaded'])
})

test('空/错/只读态：加载、失败、资产空、缺资产提示、只读原因', () => {
  for (const key of ['page.loading', 'page.error', 'assets.empty', 'assets.missingRef', 'assets.readonlyDir']) {
    assert.ok(CLIENT.includes(`t('${key}'`), `缺少状态文案 ${key}`)
    assert.ok(dicts.zh[key] && dicts.en[key], `缺 i18n 键 ${key}`)
  }
  assert.match(CLIENT, /missing\.length > 0/, '缺资产顶部提示分支缺失')
  assert.match(CLIENT, /readOnly \? readOnlyReason/, '只读态必须禁用并给原因')
})

test('panel.pollMs 真用于轮询、panel.tab 作初始页签（非死字段）', () => {
  assert.match(CLIENT, /setInterval\(\(\) => \{ void poll\(\) \}, pollMs\)/, 'pollMs 未用于轮询')
  assert.match(CLIENT, /setTab\(norm\.panel\.tab\)/, 'panel.tab 未作初始页签')
  assert.match(CLIENT, /if \(!tabInit\.current\)/, '初始页签只应首屏生效')
})

test('纯逻辑 normalizeConfig：收敛 5 个字段并保留 panel.tab', () => {
  const p = pure()
  const norm = p.normalizeConfig({
    dsh: { defaultPersona: 'aluna' },
    bots: { '10001': { platform: 'qq', private: { bindings: { '2': '' } }, group: {} } },
    assets: { dir: '/x', watch: false },
    panel: { allowRemote: true, pollMs: 120000, tab: 'debug' },
  })
  assert.equal(norm.dsh.enabled, true, '缺省 enabled＝开启')
  assert.equal(norm.bots['10001'].private.bindings['2'], undefined, '空绑定值必须丢弃')
  assert.deepEqual(norm.assets, { dir: '/x', watch: false })
  assert.deepEqual(norm.panel, { allowRemote: true, pollMs: 120000, tab: 'debug' })
})

test('纯逻辑 reasonText：11 条降级原因走 locale，未知码原样', () => {
  const p = pure()
  const codes = ['source_missing', 'bot_id_required', 'bot_unknown', 'bot_disabled', 'platform_mismatch',
    'chat_type_invalid', 'chat_type_disabled', 'dsh_disabled', 'default_persona_unset',
    'persona_asset_missing', 'resolve_error']
  for (const code of codes) {
    assert.ok(dicts.zh[`res.${code}`] && dicts.en[`res.${code}`], `缺 res.${code}`)
    assert.equal(p.reasonText(tZh, code), dicts.zh[`res.${code}`])
    assert.notEqual(p.reasonText(tEn, code), code, `英文 reason 未映射 ${code}`)
  }
  assert.equal(p.reasonText(tZh, 'unknown_code'), 'unknown_code')
})

test('纯逻辑 missingRefs：配置引用但资产缺失的 key 被找出（标红依据）', () => {
  const p = pure()
  const cfg = { dsh: { defaultPersona: 'ghost' }, bots: { b1: {
    private: { defaultPersona: 'aluna', bindings: { '1': 'ghost2' } }, group: { defaultPersona: '', bindings: {} },
  } } }
  const items = [{ key: 'bigfish' }, { key: 'aluna' }]
  assert.deepEqual(p.missingRefs(cfg, items), ['ghost', 'ghost2'])
})

test('纯逻辑 validateConfig：pollMs 越界与 platform=dsh 拦截', () => {
  const p = pure()
  const base = { dsh: { enabled: true, defaultPersona: 'bigfish' }, bots: {}, assets: { dir: '', watch: true },
    panel: { allowRemote: false, pollMs: 60000, tab: 'personas' } }
  assert.equal(p.validateConfig(tZh, base), '')
  assert.equal(p.validateConfig(tZh, { ...base, panel: { ...base.panel, pollMs: 1000 } }), dicts.zh['settings.pollInvalid'])
  const badBot = { ...base, bots: { '10001': { enabled: true, platform: 'dsh', private: {}, group: {} } } }
  assert.equal(p.validateConfig(tZh, badBot), dicts.zh['bots.platformInvalid'])
})

test('纯逻辑 personaOptions：英文用半角括号、缺资产带标记', () => {
  const p = pure()
  const items = [{ key: 'aluna', name: 'Aluna' }]
  const list = p.personaOptions(items, tEn, 'ghost')
  assert.equal(list.find((o) => o.value === 'aluna').label, 'Aluna (aluna)')
  const missing = list.find((o) => o.value === 'ghost')
  assert.equal(missing.missing, true)
  assert.match(missing.label, /\(ghost\)/)
  assert.doesNotMatch(missing.label, /（/)
})

test('预览：描述显示 + 20000 字截断提示', () => {
  assert.match(CLIENT, /const PREVIEW_LIMIT = 20000/)
  assert.ok(CLIENT.includes("t('assets.description')"))
  assert.ok(CLIENT.includes("t('assets.truncated'"))
  const trunc = CLIENT.slice(CLIENT.indexOf('const truncated'))
  assert.match(trunc, /preview\.text\.length > PREVIEW_LIMIT/)
})
