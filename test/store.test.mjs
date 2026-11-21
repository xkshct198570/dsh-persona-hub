/**
 * persona-store 契约测试（存储层）：出厂资产、用户覆盖、meta 合并、key 白名单、
 * 超限、watch 热重载与 dispose。全部用 mkdtempSync 临时目录 + 临时 DSH_HOME，不碰真实数据。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

import {
  KEY_RE,
  SHIPPED_PROMPTS_DIR,
  SHIPPED_META_PATH,
  resolvePromptsDir,
  resolveMetaPath,
  loadMeta,
  listPersonas,
  readPersona,
  watchPersonas,
} from '../src/host/persona-store.js'

const TRIO = ['bigfish', 'aluna', 'yiyi']

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'dsh-persona-store-'))
}

function userPrompts(home) {
  return join(home, 'persona-hub', 'prompts')
}

function userMeta(home) {
  return join(home, 'persona-hub', 'meta.json')
}

/** 在临时 DSH_HOME 里跑 fn，结束后还原 env 并删目录。 */
async function withTempHome(fn) {
  const home = tempHome()
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await fn(home)
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    rmSync(home, { recursive: true, force: true })
  }
}

function cfgFor(home, extra = {}) {
  return { assets: { dir: userPrompts(home), ...extra } }
}

test('出厂三角色（bigfish/aluna/yiyi）可从 shipped 读到', async () => {
  await withTempHome(async (home) => {
    // 用户目录不存在 = 纯出厂态
    assert.equal(existsSync(userPrompts(home)), false)
    assert.ok(SHIPPED_PROMPTS_DIR.startsWith('/') && SHIPPED_PROMPTS_DIR.endsWith(join('personas', 'prompts')))
    assert.ok(existsSync(SHIPPED_META_PATH))
    assert.ok(existsSync(SHIPPED_PROMPTS_DIR))

    const list = listPersonas(cfgFor(home))
    for (const key of TRIO) {
      const item = list.find((x) => x.key === key)
      assert.ok(item, `列表缺 ${key}`)
      assert.equal(item.origin, 'shipped')
      assert.ok(item.chars > 100, `${key} chars=${item.chars}`)
      assert.ok(item.mtime > 0)
    }
    assert.equal(list.find((x) => x.key === 'bigfish').name, '大肥鱼')
    assert.equal(list.find((x) => x.key === 'aluna').name, '阿罗娜')
    assert.equal(list.map((x) => x.key).join(','), [...list.map((x) => x.key)].sort().join(','))

    for (const key of TRIO) {
      const got = readPersona(cfgFor(home), key)
      assert.equal(got.ok, true, `${key}: ${JSON.stringify(got)}`)
      assert.equal(got.key, key)
      assert.ok(got.text.length > 100)
      assert.equal(typeof got.mtime, 'number')
      assert.equal(got.meta.avatar, '')
    }
    assert.match(readPersona(cfgFor(home), 'bigfish').text, /大肥鱼/)
  })
})

test('用户同名文件覆盖出厂资产，未覆盖的仍回退出厂', async () => {
  await withTempHome(async (home) => {
    const dir = userPrompts(home)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'bigfish.txt'), '用户改写的大肥鱼人设', 'utf8')
    const cfg = cfgFor(home)

    const got = readPersona(cfg, 'bigfish')
    assert.equal(got.ok, true)
    assert.equal(got.text, '用户改写的大肥鱼人设')
    assert.equal(got.meta.name, '大肥鱼', 'meta 名称仍来自出厂 meta 合并')

    const list = listPersonas(cfg)
    const bigfish = list.find((x) => x.key === 'bigfish')
    assert.equal(bigfish.origin, 'user')
    assert.equal(bigfish.chars, '用户改写的大肥鱼人设'.length, 'chars 是字符数而非字节数')
    assert.equal(list.find((x) => x.key === 'aluna').origin, 'shipped')
    assert.match(readPersona(cfg, 'aluna').text, /阿罗娜/)
  })
})

test('meta 合并：出厂全保留，用户同名 key 覆盖、新 key 追加', async () => {
  await withTempHome(async (home) => {
    const metaPath = userMeta(home)
    mkdirSync(join(home, 'persona-hub'), { recursive: true })
    writeFileSync(metaPath, JSON.stringify({
      bigfish: { name: '塘主的大肥鱼', avatar: '/avatars/bigfish.png' },
      custom: { name: '自定义角色', avatar: '' },
      'bad/key': { name: '应被忽略' },
      scalar: 'ignored',
    }), 'utf8')

    const meta = loadMeta(cfgFor(home))
    assert.equal(meta.bigfish.name, '塘主的大肥鱼')
    assert.equal(meta.bigfish.avatar, '/avatars/bigfish.png')
    assert.equal(meta.aluna.name, '阿罗娜', '出厂 meta 保留')
    assert.equal(meta.yiyi.name, '一叶')
    assert.equal(meta.custom.name, '自定义角色')
    assert.equal(meta['bad/key'], undefined)
    assert.equal(meta.scalar, undefined)

    const got = readPersona(cfgFor(home), 'bigfish')
    assert.equal(got.ok, true)
    assert.deepEqual(got.meta, { name: '塘主的大肥鱼', avatar: '/avatars/bigfish.png' })
  })
})

test('坏 meta / 坏条目不抛，返回已解析部分', async () => {
  await withTempHome(async (home) => {
    const metaPath = userMeta(home)
    mkdirSync(join(home, 'persona-hub'), { recursive: true })

    writeFileSync(metaPath, '{ "bigfish": { "name": "半截', 'utf8')
    const broken = loadMeta(cfgFor(home))
    assert.equal(broken.bigfish.name, '大肥鱼', '坏 JSON 整体忽略，出厂 meta 生效')
    assert.equal(listPersonas(cfgFor(home)).length >= 3, true)
    assert.equal(readPersona(cfgFor(home), 'bigfish').ok, true)

    writeFileSync(metaPath, '[]', 'utf8')
    assert.equal(loadMeta(cfgFor(home)).aluna.name, '阿罗娜')

    writeFileSync(metaPath, JSON.stringify({ bigfish: 'not-an-object' }), 'utf8')
    assert.equal(loadMeta(cfgFor(home)).bigfish.name, '大肥鱼')

    writeFileSync(metaPath, '', 'utf8')
    assert.equal(loadMeta(cfgFor(home)).yiyi.name, '一叶')
  })
})

test('key 白名单：拒绝路径穿越、绝对路径、超长与非 ASCII', async () => {
  await withTempHome(async (home) => {
    const cfg = cfgFor(home)
    const badKeys = [
      '../evil',
      '../../etc/passwd',
      '/etc/passwd',
      'a/b',
      'a\\b',
      '..%2f..%2fetc',
      'x'.repeat(65),
      '',
      '   ',
      '中文key',
    ]
    for (const key of badKeys) {
      const got = readPersona(cfg, key)
      assert.equal(got.ok, false, `应拒绝: ${JSON.stringify(key)}`)
      assert.equal(got.error, 'invalid_key', `应返回 invalid_key: ${JSON.stringify(key)}`)
    }
    assert.equal(KEY_RE.test('bigfish'), true)
    assert.equal(KEY_RE.test('v1.2_ok-x'), true)
    assert.equal(KEY_RE.test('../x'), false)
    // 合法但不存在 → missing，而不是 invalid_key
    assert.equal(readPersona(cfg, 'v1.2_ok-x').error, 'persona_missing')
  })
})

test('watch 热重载：300ms 内触发、meta 变更触发、dispose 后不再触发', async () => {
  await withTempHome(async (home) => {
    const dir = userPrompts(home)
    mkdirSync(dir, { recursive: true })
    let hits = 0
    const dispose = watchPersonas(cfgFor(home), () => { hits += 1 })

    try {
      writeFileSync(join(dir, 'bigfish.txt'), '热重载 v1', 'utf8')
      const deadline = Date.now() + 300
      while (hits === 0 && Date.now() < deadline) await sleep(20)
      assert.ok(hits >= 1, `300ms 内应触发 onChange，实际 ${hits}`)

      // meta.json 变更同样触发（写入前先确保目录已存在）
      const beforeMeta = hits
      writeFileSync(userMeta(home), JSON.stringify({ bigfish: { name: '热重载名' } }), 'utf8')
      const metaDeadline = Date.now() + 300
      while (hits === beforeMeta && Date.now() < metaDeadline) await sleep(20)
      assert.ok(hits > beforeMeta, 'meta 变更应触发 onChange')

      dispose()
      const settled = hits
      writeFileSync(join(dir, 'bigfish.txt'), 'dispose 之后', 'utf8')
      writeFileSync(userMeta(home), JSON.stringify({ bigfish: { name: 'dispose 之后' } }), 'utf8')
      await sleep(300)
      assert.equal(hits, settled, 'dispose 后不应再触发')
    } finally {
      dispose()
    }
  })
})

test('正文超限返回 persona_too_large（默认 200k 字符边界）', async () => {
  await withTempHome(async (home) => {
    const dir = userPrompts(home)
    mkdirSync(dir, { recursive: true })
    const cfg = cfgFor(home)

    writeFileSync(join(dir, 'huge.txt'), 'a'.repeat(200_001), 'utf8')
    const huge = readPersona(cfg, 'huge')
    assert.equal(huge.ok, false)
    assert.equal(huge.error, 'persona_too_large')

    writeFileSync(join(dir, 'exact.txt'), 'a'.repeat(200_000), 'utf8')
    const exact = readPersona(cfg, 'exact')
    assert.equal(exact.ok, true, '恰好 200k 应可读')
    assert.equal(exact.text.length, 200_000)

    writeFileSync(join(dir, 'cn.txt'), '鱼'.repeat(200_001), 'utf8')
    assert.equal(readPersona(cfg, 'cn').error, 'persona_too_large')

    // 上限按字符数而非字节数：20 万汉字（约 600KB）应可读
    writeFileSync(join(dir, 'cn-exact.txt'), '鱼'.repeat(200_000), 'utf8')
    const cnExact = readPersona(cfg, 'cn-exact')
    assert.equal(cnExact.ok, true, '字符数恰好 200k 的汉字文件应可读')
    assert.equal(cnExact.text.length, 200_000)

    writeFileSync(join(dir, 'short.txt'), '超过自定义上限', 'utf8')
    assert.equal(readPersona({ assets: { dir }, maxChars: 3 }, 'short').error, 'persona_too_large')
    assert.equal(readPersona({ assets: { dir }, maxChars: 100 }, 'short').ok, true)
  })
})

test('缺文件 / BOM 剥离 / 默认路径 / watch 开关关闭', async () => {
  await withTempHome(async (home) => {
    const cfg = cfgFor(home)
    assert.equal(readPersona(cfg, 'nobody').error, 'persona_missing')

    assert.equal(resolvePromptsDir({}), join(home, 'persona-hub', 'prompts'))
    assert.equal(resolveMetaPath({}), userMeta(home))
    assert.equal(resolvePromptsDir(cfg), userPrompts(home))

    const dir = userPrompts(home)
    mkdirSync(join(dir, 'sub.txt'), { recursive: true }) // 同名目录应被 list 跳过
    writeFileSync(join(dir, 'bom.txt'), '\uFEFFBOM 之后', 'utf8')
    assert.equal(readPersona(cfg, 'bom').text, 'BOM 之后')

    writeFileSync(join(dir, 'readme.md'), '不是人设', 'utf8')
    writeFileSync(join(dir, 'bad name.txt'), '非法文件名', 'utf8')
    const list = listPersonas(cfg)
    assert.equal(list.some((x) => x.key === 'readme'), false)
    assert.equal(list.some((x) => x.key === 'bad name'), false)
    assert.equal(list.some((x) => x.key === 'sub'), false)
    assert.equal(list.find((x) => x.key === 'bom').origin, 'user')
    assert.equal(list.find((x) => x.key === 'aluna').origin, 'shipped')

    let fired = 0
    // 目录/文件全部不存在时 watch 不得抛，dispose 可正常关闭
    const bareHome = join(home, 'bare-home')
    const saved = process.env.DSH_HOME
    process.env.DSH_HOME = bareHome
    try {
      const bareDispose = watchPersonas({ assets: { dir: join(home, 'no-such-prompts') } }, () => { fired += 1 })
      assert.equal(typeof bareDispose, 'function')
      bareDispose()
    } finally {
      process.env.DSH_HOME = saved
    }
    const dispose = watchPersonas({ assets: { dir, watch: false } }, () => { fired += 1 })
    assert.equal(typeof dispose, 'function')
    dispose()
    dispose() // 幂等
    await sleep(200)
    assert.equal(fired, 0)
  })
})
