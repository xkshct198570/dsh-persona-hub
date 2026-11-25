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
 * 本文件同时是 locale 判据的唯一实现（compare-baseline 直接 import，禁止各自复制一份）；
 * CLI 只在被直接执行时运行，import 不产生副作用。
 *
 * 用法：
 *   node scripts/capture-baseline.mjs [--phase P5a|P5b] [--dry-run] [--rewrite-locale]
 *
 * 依赖方向：scripts → node 原生模块 + lib/client.js；不 import 业务代码。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const CLIENT = path.join(ROOT, 'lib/client.js')
export const BASELINE_DIR = path.join(ROOT, 'scripts/baseline/persona')
export const PHASES = new Set(['P5a', 'P5b'])
export const MARK_START = '// >>> locale:generated'
export const MARK_END = '// <<< locale:generated'

/**
 * 每语言键数（locale 对象 → { lang: n }）。
 * @param {Record<string, Record<string, string>>} value locale 对象
 * @returns {Record<string, number>} 每语言键数
 */
export function localeCounts(value) {
  return Object.fromEntries(Object.keys(value).map((lang) => [lang, Object.keys(value[lang]).length]))
}

/**
 * 从客户端源码的 locale 生成块提取 dict 对象（纯 JSON 文本 parse，禁止 eval）。
 * @param {string} src lib/client.js 全文
 * @returns {Record<string, Record<string, string>>} locale 对象
 * @throws {Error} 标记缺失/块结构异常/dict 不是纯 JSON 时抛出
 */
export function extractLocaleObject(src) {
  const s = src.indexOf(MARK_START)
  const e = src.indexOf(MARK_END)
  if (s < 0 || e < 0 || e < s) throw new Error('找不到 locale 生成块标记（start/end），无法提取 locale 对象')
  const block = src.slice(s, e)
  const dictPos = block.indexOf('const dict =')
  if (dictPos < 0) throw new Error('locale 生成块里找不到 `const dict =`')
  const braceStart = block.indexOf('{', dictPos)
  const braceEnd = block.lastIndexOf('}')
  if (braceStart < 0 || braceEnd <= braceStart) throw new Error('locale 生成块里 dict 对象花括号不完整')
  let value
  try {
    value = JSON.parse(block.slice(braceStart, braceEnd + 1))
  } catch (err) {
    throw new Error(`dict 文本不是纯 JSON（${err.message}）；生成块必须由 i18n-check 生成，禁止手改`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('dict 不是 { lang: { key: value } } 对象')
  return value
}

/**
 * 命令行参数解析。
 * @param {string[]} argv 参数
 * @returns {{phase: string|null, dryRun: boolean, rewriteLocale: boolean, help: boolean}} 选项
 */
function parseArgs(argv) {
  const options = { phase: null, dryRun: false, rewriteLocale: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--rewrite-locale') {
      options.rewriteLocale = true
    } else if (arg === '--phase') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error('--phase 缺少取值（P5a|P5b）')
      options.phase = value
      i += 1
    } else if (arg.startsWith('--phase=')) {
      options.phase = arg.slice('--phase='.length)
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`未知参数：${arg}`)
    }
  }
  return options
}

/**
 * 解析 phase：--phase 优先，其次 current.json，缺省 P5a（P5a1 首跑）。
 * @param {string|null} override --phase 取值
 * @returns {{phase: string, source: string}} phase 与来源
 */
function resolvePhase(override) {
  if (override) {
    if (!PHASES.has(override)) throw new Error(`非法 phase：${override}（只认 P5a|P5b）`)
    return { phase: override, source: '--phase' }
  }
  const currentFile = path.join(BASELINE_DIR, 'current.json')
  if (fs.existsSync(currentFile)) {
    const current = JSON.parse(fs.readFileSync(currentFile, 'utf8'))
    if (!PHASES.has(current?.phase)) throw new Error(`current.json phase 非法：${JSON.stringify(current?.phase)}`)
    return { phase: current.phase, source: 'current.json' }
  }
  return { phase: 'P5a', source: 'default' }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('用法: node scripts/capture-baseline.mjs [--phase P5a|P5b] [--dry-run] [--rewrite-locale]')
    return
  }
  if (!fs.existsSync(CLIENT)) throw new Error('缺少 lib/client.js')
  const original = fs.readFileSync(CLIENT)
  const src = original.toString('utf8')

  // 语法预检：产物坏了不应被采成基线。
  try {
    new Function(src) // eslint-disable-line no-new-func
  } catch (err) {
    throw new Error(`lib/client.js 语法预检失败：${err.message}`)
  }

  const { phase, source: phaseSource } = resolvePhase(options.phase)
  const localeObject = extractLocaleObject(src)
  const langs = Object.keys(localeObject)
  if (!langs.includes('zh') || !langs.includes('en')) throw new Error(`dict 语言集异常：${langs.join(',')}（期望含 zh/en）`)
  const keyCounts = localeCounts(localeObject)
  const counts = Object.values(keyCounts)
  if (new Set(counts).size !== 1) throw new Error(`各语言键数不一致：${JSON.stringify(keyCounts)}`)

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
  console.log(`[capture] locale 来源 client.js 生成块 dict（JSON.parse 生成块文本） · ${langs.join('/')} 各 ${counts[0]} 键`)
  if (keepLocale) {
    console.log(`[capture] 保留既有 locale-object.json（phase ${phase} 不得自吸收；--rewrite-locale 才覆盖）`)
  }
  for (const w of writes) console.log(`[capture] ${options.dryRun ? 'would write' : 'write'} ${path.relative(ROOT, w.file)}（${w.what}）`)

  if (options.dryRun) return
  fs.mkdirSync(BASELINE_DIR, { recursive: true })
  for (const w of writes) fs.writeFileSync(w.file, w.data)
  console.log('[capture] 完成')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main()
  } catch (err) {
    console.error(`[capture] ${err?.message || err}`)
    process.exit(1)
  }
}
