#!/usr/bin/env node
/**
 * 基线对拍（人设仓）：拿 scripts/baseline/persona/ 的快照与当前工作树逐项比较。
 *
 * 口径（P5a1 起）：client 产物 sha（按 phase 取 client.sha256.<phase>）+ locale 逐 key 对象等价。
 * 未收录项**显式打印 skipped 与原因**（铁律 22：禁止静默跳过）：
 * - exports：人设 client 无顶层 ESM 导出面，门面导出面判据在 P6 固化；
 * - routes：P5d 审计阶段用 test/routes.test.mjs + 契约用例判，本闸不做 HTTP 快照；
 * - test-counts：由 `npm test` 三元组自身判（145/145/0），本闸不重复采集。
 *
 * 用法：node scripts/compare-baseline.mjs [--phase P5a|P5b] [--no-tests]
 * - phase 缺省读 scripts/baseline/persona/current.json，缺失时按 P5a。
 * - 任一不一致打印 `[compare] FAIL: ...` 并 exit 1。
 *
 * 依赖方向：复用 capture-baseline.mjs 的纯函数；本文件不写任何快照。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_DIR = join(ROOT, 'scripts/baseline/persona')
const CLIENT = join(ROOT, 'lib/client.js')
const PHASES = new Set(['P5a', 'P5b'])

/**
 * 读基线文件原文。
 * @param {string} name 基线文件名
 * @returns {string} 文本
 */
function readBaseline(name) {
  const file = join(BASELINE_DIR, name)
  if (!existsSync(file)) throw new Error(`缺少基线 ${name}，先跑 node scripts/capture-baseline.mjs`)
  return readFileSync(file, 'utf8')
}

/**
 * 读基线 JSON。
 * @param {string} name 基线文件名
 * @returns {unknown} 解析结果
 */
function readBaselineJson(name) {
  try {
    return JSON.parse(readBaseline(name))
  } catch (err) {
    throw new Error(`基线 ${name} 解析失败: ${err?.message || err}`)
  }
}

/**
 * 找两个 JSON 值的第一处差异（深比较的人读版）。
 * @param {unknown} a 基线值
 * @param {unknown} b 当前值
 * @param {string} [at] 当前路径标签
 * @returns {string|null} 差异描述；一致返回 null
 */
function firstDiff(a, b, at = '$') {
  if (a === b) return null
  if (a === null || b === null) return `${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`
  if (typeof a !== typeof b) return `${at}: 类型 ${typeof a} != ${typeof b}`
  if (typeof a !== 'object') return `${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`
  if (Array.isArray(a) !== Array.isArray(b)) return `${at}: 数组/对象不一致`
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${at}: 数组长度 ${a.length} != ${b.length}`
    for (let i = 0; i < a.length; i += 1) {
      const hit = firstDiff(a[i], b[i], `${at}[${i}]`)
      if (hit) return hit
    }
    return null
  }
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return `${at}: 键数 ${keysA.length} != ${keysB.length}`
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return `${at}.${key}: 当前值缺失`
    const hit = firstDiff(a[key], b[key], `${at}.${key}`)
    if (hit) return hit
  }
  return null
}

/** @param {string} text 文本 @returns {Record<string, number>} 每语言键数 */
const localeCounts = (text) => Object.fromEntries(Object.keys(text).map((lang) => [lang, Object.keys(text[lang]).length]))

/**
 * 命令行参数解析。
 * @param {string[]} argv 参数
 * @returns {{phase: string|null, noTests: boolean, help: boolean}} 选项
 */
function parseArgs(argv) {
  const options = { phase: null, noTests: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--no-tests') {
      options.noTests = true
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
      throw new Error(`未知参数: ${arg}`)
    }
  }
  return options
}

/**
 * 解析本轮比较使用的 phase。
 * @param {string|null} override --phase 覆盖值
 * @returns {{phase: string, source: string}} phase 与来源
 */
function resolvePhase(override) {
  if (override) {
    if (!PHASES.has(override)) throw new Error(`非法 phase: ${override}（只认 P5a|P5b）`)
    return { phase: override, source: '--phase' }
  }
  const currentFile = join(BASELINE_DIR, 'current.json')
  if (existsSync(currentFile)) {
    const current = readBaselineJson('current.json')
    if (!PHASES.has(current?.phase)) throw new Error(`current.json phase 非法: ${JSON.stringify(current?.phase)}`)
    return { phase: current.phase, source: 'current.json' }
  }
  return { phase: 'P5a', source: 'default' }
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`[compare] ${err?.message || err}`)
    process.exitCode = 2
    return
  }
  if (options.help) {
    console.log('用法: node scripts/compare-baseline.mjs [--phase P5a|P5b] [--no-tests]')
    return
  }

  let resolved
  try {
    resolved = resolvePhase(options.phase)
  } catch (err) {
    console.error(`[compare] ${err?.message || err}`)
    process.exitCode = 2
    return
  }
  const phase = resolved.phase
  console.log(`[compare] phase: ${phase} (${resolved.source})`)

  const failures = []
  const fail = (message) => {
    failures.push(message)
    console.log(`[compare] FAIL: ${message}`)
  }
  const ok = (label, detail) => console.log(`[compare] ${label}: ok${detail ? ` (${detail})` : ''}`)

  // 1) client 产物 sha
  try {
    const line = readBaseline(`client.sha256.${phase.toLowerCase()}`).split(/\r?\n/, 1)[0]
    const match = /^([0-9a-f]{64})  lib\/client\.js$/.exec(line)
    if (!match) {
      fail(`client-sha: 基线首行格式非法: ${JSON.stringify(line.slice(0, 96))}`)
    } else {
      const { createHash } = await import('node:crypto')
      const current = createHash('sha256').update(readFileSync(CLIENT)).digest('hex')
      if (match[1] !== current) fail(`client-sha: 基线 ${match[1]} != 当前 ${current}`)
      else ok('client-sha', current.slice(0, 12))
    }
  } catch (err) {
    fail(`client-sha: ${err?.message || err}`)
  }

  // 2) locale 逐 key 对象等价
  try {
    const baseline = readBaselineJson('locale-object.json')
    const src = readFileSync(CLIENT, 'utf8')
    const start = src.indexOf('// >>> locale:generated')
    const end = src.indexOf('// <<< locale:generated')
    if (start < 0 || end < 0 || end < start) throw new Error('找不到 locale 生成块标记')
    const block = src.slice(start, end)
    const dictPos = block.indexOf('const dict =')
    const braceStart = block.indexOf('{', dictPos)
    const braceEnd = block.lastIndexOf('}')
    if (dictPos < 0 || braceStart < 0 || braceEnd <= braceStart) throw new Error('locale 生成块 dict 结构异常')
    const current = JSON.parse(block.slice(braceStart, braceEnd + 1))
    if (!isDeepStrictEqual(baseline, current)) {
      fail(`locale-object: 深比较不一致（${firstDiff(baseline, current) || '对象结构不一致'}）`)
    } else {
      const counts = localeCounts(current)
      ok('locale-object', Object.entries(counts).map(([lang, n]) => `${lang}=${n}`).join(' '))
    }
  } catch (err) {
    fail(`locale-object: ${err?.message || err}`)
  }

  // 3) 未收录项：显式跳过并给出判据归属，不许静默。
  console.log(`[compare] exports: skipped (人设 client 无顶层 ESM 导出面；门面导出面判据 P6 固化)`)
  console.log(`[compare] routes: skipped (P5d routes 审计阶段用契约用例判，本闸不做 HTTP 快照)`)
  console.log(options.noTests
    ? '[compare] test-counts: skipped (--no-tests)'
    : '[compare] test-counts: skipped (由 npm test 三元组 145/145/0 自身判，本闸不重复采集)')
  console.log('[compare] render-tree: skipped (无渲染树基线源；页签冒烟在 P5c 用 test/client/*.test.mjs)')

  if (failures.length > 0) {
    console.log(`[compare] FAIL: ${failures.length} 项不一致`)
    process.exitCode = 1
    return
  }
  console.log(`[compare] ok (phase ${phase})`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`[compare] FAIL: ${err?.message || err}`)
    process.exitCode = 1
  })
}
