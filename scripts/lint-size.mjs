#!/usr/bin/env node
/**
 * 体量闸（人设仓）：把铁律 23 的 800/1200/2000 落成机检，统计手写逻辑有效行并对旧源码基线。
 *
 * 有效行判据：按 \n 切行；trim 后空行不计；纯 // 行不计；块注释内的行不计；
 * 其余计 1。字符串/模板字面量里的注释记号不算注释（acorn onComment 精确切注释区间）。
 *
 * 分组：source=src/**\/*.{js,mjs}；clientSrc=lib/client-src/**\/*.js（排除 generated，片段按行级口径）；
 * tests=test/**\/*.mjs；scripts=scripts/**\/*.mjs（门禁脚本只列数字、不套阈值）。
 * 产物 lib/client.js、node_modules、generated、vendored 一律排除。
 *
 * 人设仓独立基线：scripts/baseline/persona/lint-size.json（不复用鲸忆 phase）。
 *
 * 依赖方向：scripts → node 原生模块 + acorn；不 import 业务代码。
 * 用法：node scripts/lint-size.mjs [--write|--check]（缺省 --check）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as acorn from 'acorn'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(ROOT, 'scripts/baseline/persona/lint-size.json')
const THRESHOLDS = { plan: 800, freeze: 1200, split: 2000 }
const PRUNE_DIRS = new Set(['node_modules', 'generated', 'vendored', '.git'])
const PRODUCED = new Set(['lib/client.js'])

// 门禁脚本自身不设体量阈值：它们是装配层/构建入口，只随基线列数字。
const EXEMPT_SCRIPTS = new Set([
  'scripts/build-client.mjs',
  'scripts/split-client.mjs',
  'scripts/capture-baseline.mjs',
  'scripts/compare-baseline.mjs',
  'scripts/lint-size.mjs',
  'scripts/check.mjs',
  'scripts/i18n-check.mjs',
])

/**
 * 递归收集匹配文件；跳过 node_modules/generated/vendored 等目录。
 * @param {string} dir 绝对目录
 * @param {(abs: string) => boolean} match 文件名判据
 * @param {string[]} out 累积结果
 * @returns {string[]} 绝对路径列表
 */
function walk(dir, match, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (PRUNE_DIRS.has(entry.name)) continue
      walk(abs, match, out)
    } else if (entry.isFile() && match(abs)) {
      out.push(abs)
    }
  }
  return out
}

/** @param {string} abs @returns {string} 仓库相对 POSIX 路径 */
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

const PARSE_OPTS = { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }

/**
 * 统计一段源码的手写逻辑有效行。
 * @param {string} text 源码全文
 * @param {string} [label] 文件标识（解析失败告警用）
 * @param {boolean} [fragment] 片段（同一 factory 作用域，不保证独立可 parse）
 * @returns {number} 有效行数
 */
export function effectiveLines(text, label = '<memory>', fragment = false) {
  const lines = text.split('\n')
  if (fragment) return fallbackLines(lines)
  /** @type {{start: number, end: number}[]} */
  const comments = []
  try {
    acorn.parse(text, { ...PARSE_OPTS, onComment: comments })
  } catch (err) {
    // 不静默（铁律 22）：告警后回退到行级启发式，字符串内的注释记号无法区分。
    console.error(`[lint-size] warn：${label} 解析失败，回退行级计行（${err.message}）`)
    return fallbackLines(lines)
  }
  const isCode = new Uint8Array(text.length).fill(1)
  for (const comment of comments) isCode.fill(0, comment.start, comment.end)
  let count = 0
  let offset = 0
  for (const line of lines) {
    if (line.trim() !== '') {
      let hasCode = false
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i]
        if (ch === ' ' || ch === '\t' || ch === '\r') continue
        if (isCode[offset + i] === 1) {
          hasCode = true
          break
        }
      }
      if (hasCode) count += 1
    }
    offset += line.length + 1
  }
  return count
}

/**
 * 片段/解析失败时的回退计行：引号感知的行扫描。
 * 片段是同一作用域里的文本，常不可独立 parse，但必须准确区分「注释」与「字符串里的 //、/*」，
 * 否则 locale 字典/URL 字符串会被误当注释而少算行（体量闸即 fail-open）。
 * @param {string[]} lines 按 \n 切开的行
 * @returns {number} 有效行数
 */
function fallbackLines(lines) {
  /** 跨行状态：块注释内 / 字符串（' " `）内。模板字符串的 ${} 嵌套不展开（本仓未跨行用）。 */
  let inBlock = false
  let quote = null
  let count = 0
  for (const line of lines) {
    let hasCode = false
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (inBlock) {
        if (ch === '*' && line[i + 1] === '/') {
          inBlock = false
          i += 1
        }
        continue
      }
      if (quote) {
        if (ch === '\\') {
          i += 1
        } else if (ch === quote) {
          quote = null
        }
        hasCode = true
        continue
      }
      if (ch === '/' && line[i + 1] === '/') break
      if (ch === '/' && line[i + 1] === '*') {
        inBlock = true
        i += 1
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch
        hasCode = true
        continue
      }
      if (ch !== ' ' && ch !== '\t' && ch !== '\r') hasCode = true
    }
    if (hasCode) count += 1
  }
  return count
}

/**
 * 统计一组文件的有效行。
 * @param {string[]} files 绝对路径
 * @returns {Map<string, number>} 仓库相对路径 → 有效行（按路径排序）
 */
function countGroup(files) {
  const map = new Map()
  for (const abs of files.sort()) {
    const fileRel = rel(abs)
    if (PRODUCED.has(fileRel)) continue
    map.set(fileRel, effectiveLines(fs.readFileSync(abs, 'utf8'), fileRel, fileRel.startsWith('lib/client-src/')))
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])))
}

/** 收集四组当前体量。 */
function collect() {
  return {
    source: countGroup(walk(path.join(ROOT, 'src'), (abs) => /\.(?:js|mjs)$/.test(abs))),
    clientSrc: countGroup(walk(path.join(ROOT, 'lib/client-src'), (abs) => /\.js$/.test(abs))),
    tests: countGroup(walk(path.join(ROOT, 'test'), (abs) => /\.mjs$/.test(abs))),
    scripts: countGroup(walk(path.join(ROOT, 'scripts'), (abs) => /\.mjs$/.test(abs))),
  }
}

/**
 * 打印一组的分列统计。
 * @param {string} label 组名
 * @param {Map<string, number>} map 文件体量
 */
function report(label, map) {
  const over = [...map.entries()].filter(([, n]) => n > THRESHOLDS.plan).sort((a, b) => b[1] - a[1])
  const max = map.size === 0 ? 0 : Math.max(...map.values())
  const note = label === 'clientSrc' ? '（文本片段按行级口径）' : ''
  console.log(`[lint-size] ${label}: ${map.size} 个文件，最大 ${max} 行，>800 共 ${over.length} 个${note}`)
  for (const [file, n] of over) console.log(`  ${String(n).padStart(5)}  ${file}`)
}

/** 把 Map 转成按路径排序的普通对象（写基线用）。 */
function toObject(map) {
  const obj = {}
  for (const [file, n] of map) obj[file] = n
  return obj
}

/**
 * --write：把旧源码三组体量写入基线（不写 clientSrc，基线只列旧源码）。
 * @param {ReturnType<typeof collect>} groups
 */
function writeBaseline(groups) {
  const data = {
    generatedAt: new Date().toISOString(),
    thresholds: THRESHOLDS,
    source: toObject(groups.source),
    tests: toObject(groups.tests),
    scripts: toObject(groups.scripts),
  }
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true })
  fs.writeFileSync(BASELINE, `${JSON.stringify(data, null, 2)}\n`)
  console.log(`[lint-size] 已写基线 ${rel(BASELINE)}：source ${groups.source.size} / tests ${groups.tests.size} / scripts ${groups.scripts.size}`)
}

/**
 * --check：对照基线判增长/新增超限/绝对上限，违规逐条 FAIL。
 * @param {ReturnType<typeof collect>} groups
 * @returns {string[]} 违规描述
 */
function check(groups) {
  if (!fs.existsSync(BASELINE)) {
    return [`缺少基线 ${rel(BASELINE)}：先跑 node scripts/lint-size.mjs --write`]
  }
  let baseline
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  } catch (err) {
    return [`基线 ${rel(BASELINE)} 解析失败：${err.message}`]
  }

  const fails = []
  // clientSrc 永远不在基线里：新增手写文件必须 ≤800，>1200 绝对违规。
  for (const [file, n] of groups.clientSrc) {
    if (n > THRESHOLDS.plan) {
      const limit = n > THRESHOLDS.freeze ? `${THRESHOLDS.freeze}（client-src 绝对上限）` : `${THRESHOLDS.plan}（client-src 新增上限）`
      fails.push(`${file} ${n} > ${limit}`)
    }
  }
  for (const group of ['source', 'tests', 'scripts']) {
    const base = baseline[group] ?? {}
    for (const [file, n] of groups[group]) {
      if (group === 'scripts' && EXEMPT_SCRIPTS.has(file)) continue
      if (Object.prototype.hasOwnProperty.call(base, file)) {
        if (n > base[file]) fails.push(`${file} ${n} > ${base[file]}（增长，存量只减不增）`)
      } else if (n > THRESHOLDS.split) {
        fails.push(`${file} ${n} > ${THRESHOLDS.split}（新增绝对超限）`)
      } else if (n > THRESHOLDS.plan) {
        fails.push(`${file} ${n} > ${THRESHOLDS.plan}（新增超限）`)
      }
    }
  }
  return fails
}

/** CLI：--write 落基线 / 缺省 --check 对基线判违规；import 时不执行。 */
function main() {
  const args = process.argv.slice(2)
  const known = new Set(['--write', '--check'])
  for (const arg of args) {
    if (!known.has(arg)) {
      console.error(`[lint-size] 未知参数 ${arg}；用法：node scripts/lint-size.mjs [--write|--check]`)
      process.exit(2)
    }
  }
  const mode = args.includes('--write') ? 'write' : 'check'

  const groups = collect()
  report('source', groups.source)
  report('clientSrc', groups.clientSrc)
  report('tests', groups.tests)
  report('scripts', groups.scripts)

  if (mode === 'write') {
    writeBaseline(groups)
    return
  }

  const fails = check(groups)
  if (fails.length > 0) {
    for (const line of fails) console.error(`[lint-size] FAIL: ${line}`)
    process.exit(1)
  }
  console.log(
    `[lint-size] ok：source ${groups.source.size} / clientSrc ${groups.clientSrc.size} / tests ${groups.tests.size} / scripts ${groups.scripts.size} 个文件，0 违规`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main()
