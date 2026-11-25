#!/usr/bin/env node
/**
 * 人设仓基线采集：从**现有产物**取快照，不构建、不改产物、不 eval。
 *
 * 产物来源（P5a1 建立，P5b 只更新 client.sha256.p5b）：
 * - client.sha256.<phase>：`sha256  lib/client.js`（P5a1 起 build-client --check 的断言真源）
 * - locale-object.json：客户端内联 dict 逐 key 对象（从 `// >>> locale:generated` 块内的
 *   `const dict = {…}` 文本 JSON.parse 提取；块由 i18n-check 生成，键值为纯 JSON）
 * - current.json：当前基线 phase 指针
 *
 * 防自吸收：phase 非 P5a 且 locale-object.json 已存在时**不覆盖**（P5b 用它判“逐 key 等价”，
 * 写完就变成自证）；需要更新必须显式 --rewrite-locale。
 *
 * 用法：
 *   node scripts/capture-baseline.mjs [--phase P5a|P5b] [--dry-run] [--rewrite-locale]
 *
 * 依赖方向：scripts → node 原生模块 + lib/client.js；不 import 业务代码。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = path.join(ROOT, 'lib/client.js')
const BASELINE_DIR = path.join(ROOT, 'scripts/baseline/persona')
const PHASES = new Set(['P5a', 'P5b'])
const MARK_START = '// >>> locale:generated'
const MARK_END = '// <<< locale:generated'

const argv = process.argv.slice(2)
const options = { phase: null, dryRun: false, rewriteLocale: false }
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg === '--dry-run') {
    options.dryRun = true
  } else if (arg === '--rewrite-locale') {
    options.rewriteLocale = true
  } else if (arg === '--phase') {
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      console.error('[capture] --phase 缺少取值（P5a|P5b）')
      process.exit(2)
    }
    options.phase = value
    i += 1
  } else if (arg.startsWith('--phase=')) {
    options.phase = arg.slice('--phase='.length)
  } else if (arg === '--help' || arg === '-h') {
    console.log('用法: node scripts/capture-baseline.mjs [--phase P5a|P5b] [--dry-run] [--rewrite-locale]')
    process.exit(0)
  } else {
    console.error(`[capture] 未知参数：${arg}`)
    process.exit(2)
  }
}

/**
 * 解析 phase：--phase 优先，其次 current.json，缺省 P5a（P5a1 首跑）。
 * @returns {{phase: string, source: string}} phase 与来源
 */
function resolvePhase() {
  if (options.phase) {
    if (!PHASES.has(options.phase)) {
      console.error(`[capture] 非法 phase：${options.phase}（只认 P5a|P5b）`)
      process.exit(2)
    }
    return { phase: options.phase, source: '--phase' }
  }
  const currentFile = path.join(BASELINE_DIR, 'current.json')
  if (fs.existsSync(currentFile)) {
    const current = JSON.parse(fs.readFileSync(currentFile, 'utf8'))
    if (!PHASES.has(current?.phase)) {
      console.error(`[capture] current.json phase 非法：${JSON.stringify(current?.phase)}`)
      process.exit(1)
    }
    return { phase: current.phase, source: 'current.json' }
  }
  return { phase: 'P5a', source: 'default' }
}

if (!fs.existsSync(CLIENT)) {
  console.error('[capture] 缺少 lib/client.js')
  process.exit(1)
}
const original = fs.readFileSync(CLIENT)
const src = original.toString('utf8')

// 语法预检：产物坏了不应被采成基线。
try {
  new Function(src) // eslint-disable-line no-new-func
} catch (err) {
  console.error(`[capture] lib/client.js 语法预检失败：${err.message}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// locale 提取：标记块内的 `const dict = {…}`；键值为纯 JSON，禁止 eval。
// ---------------------------------------------------------------------------
/**
 * @returns {{value: Record<string, Record<string,string>>, source: string}} 对象与来源说明
 */
function extractLocaleObject() {
  const s = src.indexOf(MARK_START)
  const e = src.indexOf(MARK_END)
  if (s < 0 || e < 0 || e < s) {
    console.error('[capture] 找不到 locale 生成块标记（start/end），无法提取 locale 对象')
    process.exit(1)
  }
  const block = src.slice(s, e)
  const dictPos = block.indexOf('const dict =')
  if (dictPos < 0) {
    console.error('[capture] locale 生成块里找不到 `const dict =`')
    process.exit(1)
  }
  const braceStart = block.indexOf('{', dictPos)
  const braceEnd = block.lastIndexOf('}')
  if (braceStart < 0 || braceEnd <= braceStart) {
    console.error('[capture] locale 生成块里 dict 对象花括号不完整')
    process.exit(1)
  }
  const objectText = block.slice(braceStart, braceEnd + 1)
  let value
  try {
    value = JSON.parse(objectText)
  } catch (err) {
    console.error(`[capture] dict 文本不是纯 JSON（${err.message}）；生成块必须由 i18n-check 生成，禁止手改`)
    process.exit(1)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    console.error('[capture] dict 不是 { lang: { key: value } } 对象')
    process.exit(1)
  }
  return { value, source: 'client.js 内联 dict（JSON.parse 生成块文本）' }
}

const { phase, source: phaseSource } = resolvePhase()
const { value: localeObject, source: localeSource } = extractLocaleObject()
const langs = Object.keys(localeObject)
const keyCounts = Object.fromEntries(langs.map((lang) => [lang, Object.keys(localeObject[lang]).length]))
if (!langs.includes('zh') || !langs.includes('en')) {
  console.error(`[capture] dict 语言集异常：${langs.join(',')}（期望含 zh/en）`)
  process.exit(1)
}
const counts = Object.values(keyCounts)
if (new Set(counts).size !== 1) {
  console.error(`[capture] 各语言键数不一致：${JSON.stringify(keyCounts)}`)
  process.exit(1)
}

const sha = crypto.createHash('sha256').update(original).digest('hex')
const shaFile = path.join(BASELINE_DIR, `client.sha256.${phase.toLowerCase()}`)
const localeFile = path.join(BASELINE_DIR, 'locale-object.json')
const currentFile = path.join(BASELINE_DIR, 'current.json')

const keepLocale = fs.existsSync(localeFile) && phase !== 'P5a' && !options.rewriteLocale
const writes = [
  { file: shaFile, data: `${sha}  lib/client.js\n`, what: 'client sha' },
  ...(keepLocale ? [] : [{ file: localeFile, data: `${JSON.stringify(localeObject, null, 2)}\n`, what: 'locale 对象' }]),
  {
    file: currentFile,
    data: `${JSON.stringify({ phase, capturedAt: new Date().toISOString(), clientSha: sha, localeKeys: keyCounts }, null, 2)}\n`,
    what: 'phase 指针',
  },
]

console.log(`[capture] phase ${phase}（${phaseSource}）· lib/client.js ${original.length} bytes · sha256 ${sha}`)
console.log(`[capture] locale 来源 ${localeSource} · ${langs.join('/')} 各 ${counts[0]} 键`)
if (keepLocale) {
  console.log(`[capture] 保留既有 locale-object.json（phase ${phase} 不得自吸收；--rewrite-locale 才覆盖）`)
}
for (const w of writes) console.log(`[capture] ${options.dryRun ? 'would write' : 'write'} ${path.relative(ROOT, w.file)}（${w.what}）`)

if (options.dryRun) process.exit(0)

fs.mkdirSync(BASELINE_DIR, { recursive: true })
for (const w of writes) fs.writeFileSync(w.file, w.data)
console.log('[capture] 完成')
