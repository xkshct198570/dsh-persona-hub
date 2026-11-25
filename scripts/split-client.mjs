#!/usr/bin/env node
/**
 * 一次性源拆分器（人设仓）：把 lib/client.js 按「字节分区表」切成 lib/client-src/ 文本片段。
 *
 * 切点口径（P5 任务书 §2，2026-11-25 实测）：不是按 AST 节点声明行重算，而是 14 段行区间，
 * 上一段末行 = 下一段首行−1，首尾相接、无缝隙、无重叠。生成块/闭括号/尾部不属于单一 AST 节点，
 * 表已钉死归属：70-debug 含 Panel 闭合 `}`、99-css 从样式 banner 起、999-footer 含 factory 闭合与文件尾。
 * 因此本脚本只按行首偏移 `src.slice`（UTF-16 字符索引）→ `Buffer.from(...,'utf8')`；禁止 Buffer.subarray。
 *
 * 唯一放行闸：内存重建与源文件逐字节相等，且 sha256 == 基线 scripts/baseline/persona/client.sha256.p5a。
 *
 * 用法：
 *   node scripts/split-client.mjs                 # 默认 --dry-run：只打印切点表，不创建/覆盖任何文件
 *   node scripts/split-client.mjs --dry-run
 *   node scripts/split-client.mjs --write         # 落盘 14 片 + MANIFEST.json（不写 lib/client.js）
 *   node scripts/split-client.mjs --loader window.__ModuleLoader__.load --factory-path factory
 *
 * 依赖方向：scripts → acorn（devDependency，钉死 8.14.0）+ 基线 sha 文件；不 import 业务代码。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as acorn from 'acorn'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = path.join(ROOT, 'lib/client.js')
const SRC_DIR = path.join(ROOT, 'lib/client-src')
const BASELINE_SHA = path.join(ROOT, 'scripts/baseline/persona/client.sha256.p5a')
const ACORN_EXPECTED = '8.14.0'

// ---------------------------------------------------------------------------
// 参数：--dry-run/--write 二选一（缺省 dry-run）；--loader/--factory-path 可覆盖探针结果。
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const KNOWN = new Set(['write', 'dry-run', 'loader', 'factory-path'])
const options = {}
const bare = []
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (!arg.startsWith('--')) {
    bare.push(arg)
    continue
  }
  const eq = arg.indexOf('=')
  if (eq > 0) {
    options[arg.slice(2, eq)] = arg.slice(eq + 1)
    continue
  }
  const next = argv[i + 1]
  if (next !== undefined && !next.startsWith('--')) {
    options[arg.slice(2)] = next
    i += 1
  } else {
    options[arg.slice(2)] = true
  }
}
const unknown = [...Object.keys(options).filter((k) => !KNOWN.has(k)), ...bare]
if (unknown.length) {
  console.error(`[split] 未知参数：${unknown.join(' ')}（支持 --dry-run/--write/--loader/--factory-path）`)
  process.exit(2)
}
const write = options.write === true
const dryRun = !write
const loaderPath = String(options.loader || 'window.__ModuleLoader__.load')
const factoryPath = String(options['factory-path'] || 'factory')

if (acorn.version !== ACORN_EXPECTED) {
  console.error(`[split] acorn 版本不符：期望 ${ACORN_EXPECTED}，实际 ${acorn.version}（钉死依赖，防解析行为漂移）`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 字节分区表（任务书 §2 钉死；行号 1-based，闭区间）。MANIFEST 顺序 = 源字节顺序。
// ---------------------------------------------------------------------------
const PARTITION = [
  { file: '00-core.js', from: 1, to: 35, responsibility: '文件头注释 + __ModuleLoader__.load(id) + factory 头 + 常量（React/h/NS/PANEL_ID/TABS）' },
  { file: '10-generated.js', from: 36, to: 365, responsibility: '生成块整片：banner + 内联 dict（zh/en）+ 结束标记（scripts/i18n-check.mjs 生成，勿手改；P5b 改承载形态）' },
  { file: '20-normalize.js', from: 366, to: 595, responsibility: '数据小件 banner + 归一/校验 helper + test:pure 结束标记' },
  { file: '30-ui-kit.js', from: 596, to: 664, responsibility: 'UI 原子：Btn/Switch/Select/TextInput/Card/Row/Hint/Field' },
  { file: '40-import-editor.js', from: 665, to: 836, responsibility: '导入表单编辑器' },
  { file: '60-bots-01.js', from: 837, to: 968, responsibility: 'ChannelEditor + BotCard' },
  { file: '30-ui-kit-02.js', from: 969, to: 992, responsibility: 'TabBar + SettingRow' },
  { file: '80-settings.js', from: 993, to: 1079, responsibility: 'SettingsCard' },
  { file: '45-panel-01.js', from: 1080, to: 1571, responsibility: '滚动条 helper + Panel 头（state/callback/handler）+ return h(...) 头' },
  { file: '50-personas.js', from: 1572, to: 1702, responsibility: '角色页返回片段' },
  { file: '60-bots-02.js', from: 1703, to: 1742, responsibility: '主体页返回片段' },
  { file: '70-debug.js', from: 1743, to: 1811, responsibility: '调试页返回片段（含设置卡挂载）+ Panel 闭合 }' },
  { file: '99-css.js', from: 1812, to: 2226, responsibility: '样式分节 banner + 整片 CSS 对象（整片不拆）' },
  { file: '999-footer.js', from: 2227, to: 2255, responsibility: 'return { … } 收尾 + slots 注册 + factory 闭合 } + 文件末 })' },
]

const src = fs.readFileSync(SOURCE, 'utf8')
const original = fs.readFileSync(SOURCE)

/** @param {number} pos UTF-16 偏移 @returns {number} 1-based 行号 */
function lineOf(pos) {
  return src.slice(0, pos).split('\n').length
}

const astOpts = { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true }
let ast
try {
  ast = acorn.parse(src, astOpts)
} catch (err) {
  console.error(`[split] 源文件 acorn 解析失败：${err.message}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 探针校验：loader 调用 / factory 节点 / 函数体；不匹配宁可停，不猜着切。
// ---------------------------------------------------------------------------
const call = ast.body.find((node) => node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression')
if (!call) {
  console.error('[split] 找不到顶层 `window.__ModuleLoader__.load({...})` 调用')
  process.exit(1)
}
const calleeText = src.slice(call.expression.callee.start, call.expression.callee.end)
if (calleeText !== loaderPath) {
  console.error(`[split] loader 不匹配：期望 ${loaderPath}，实际 ${calleeText}`)
  process.exit(1)
}
const argObj = call.expression.arguments[0]
if (!argObj || argObj.type !== 'ObjectExpression') {
  console.error('[split] load() 第一个实参不是对象字面量')
  process.exit(1)
}
const factoryProp = argObj.properties.find((p) => (p.key.name || p.key.value) === factoryPath)
if (!factoryProp) {
  console.error(`[split] 对象里找不到 ${factoryPath}`)
  process.exit(1)
}
const factory = factoryProp.value
const SUPPORTED_FACTORY = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'])
if (!SUPPORTED_FACTORY.has(factory.type)) {
  console.error(`[split] factory 节点类型不支持：${factory.type}（支持 ${[...SUPPORTED_FACTORY].join('/')}）`)
  process.exit(1)
}
const body = factory.body && factory.body.type === 'BlockStatement' ? factory.body.body : null
if (!body) {
  console.error('[split] factory 不是块体函数，无法按语句切分')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 行首偏移与分区连续性：行区间必须首尾相接、覆盖 [0,len]；任一行偏移即停。
// ---------------------------------------------------------------------------
const lineStarts = [0]
for (let i = 0; i < src.length; i += 1) if (src[i] === '\n') lineStarts.push(i + 1)
const totalLines = lineStarts.length
/** @param {number} line 1-based 行号 @returns {number} 该行首 UTF-16 偏移 */
function offsetOfLine(line) {
  if (line < 1 || line > totalLines) throw new Error(`行号越界：${line}（文件 ${totalLines} 行槽）`)
  return lineStarts[line - 1]
}

const fragments = []
let prevStart = 0
for (const [i, entry] of PARTITION.entries()) {
  if (!Number.isInteger(entry.from) || !Number.isInteger(entry.to)) {
    console.error(`[split] 分区表第 ${i + 1} 项行列非整数`)
    process.exit(1)
  }
  if (entry.to < entry.from) {
    console.error(`[split] 分区表 ${entry.file} 行区间倒置：${entry.from}–${entry.to}`)
    process.exit(1)
  }
  const from = offsetOfLine(entry.from)
  const to = entry.to >= totalLines ? src.length : offsetOfLine(entry.to + 1)
  if (from !== prevStart) {
    console.error(`[split] 分区不连续：${entry.file} 起点 ${from}，上一片结束 ${prevStart}`)
    process.exit(1)
  }
  fragments.push({ ...entry, start: from, end: to, text: src.slice(from, to) })
  prevStart = to
}
if (prevStart !== src.length) {
  console.error(`[split] 分区未覆盖到 EOF：最后结束 ${prevStart}，文件长度 ${src.length}`)
  process.exit(1)
}

// 字节重建闸：任何边界/编码错误都在这里暴露，绝不写盘。
const rebuilt = Buffer.concat(fragments.map((f) => Buffer.from(f.text, 'utf8')))
if (Buffer.compare(rebuilt, original) !== 0) {
  console.error('[split] 内存重建与源文件不是逐字节相等，拒绝继续（先修边界/编码，不许逻辑等价放行）')
  process.exit(1)
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const rebuiltSha = sha(rebuilt)

/** 有效行口径：非空、非纯注释、非块注释内（本仓脚本只做展示，不参与体量闸）。 */
function effectiveLines(text) {
  let n = 0
  let inBlock = false
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (inBlock) {
      if (t.includes('*/')) inBlock = false
      continue
    }
    if (!t || t.startsWith('//')) continue
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true
      continue
    }
    n += 1
  }
  return n
}

const truncate = (text) => {
  const first = text.split('\n')[0]
  return first.length > 60 ? `${first.slice(0, 60)}…` : first
}

// ---------------------------------------------------------------------------
// 报告：切点表 + 首片头 200 / 尾片尾 200 + 重建 sha vs 基线。
// ---------------------------------------------------------------------------
console.log(`[split] acorn ${acorn.version} · factory 节点 ${factory.type}（属性 ${factoryProp.type}）· 行 ${lineOf(factory.start)}–${lineOf(factory.end)} · body ${body.length} 条 · 片段 ${fragments.length} 片`)
console.log('片段 | 行区间 | UTF-16 | 字节 | 行数 | 有效行 | 首行 | 边界')
for (const f of fragments) {
  const bytes = Buffer.byteLength(f.text, 'utf8')
  const lines = f.text.split('\n').length
  const boundary = f.file === '00-core.js' ? '文件头'
    : f.file === '10-generated.js' ? '生成块整片'
      : f.file === '999-footer.js' ? 'factory 闭合+文件尾'
        : '行首边界（§2 钉死）'
  const flag = lines > 1200 ? ' ⚠子切候选' : ''
  console.log(`${f.file} | ${f.from}–${f.to} | ${f.start}-${f.end} | ${bytes} | ${lines} | ${effectiveLines(f.text)} | ${JSON.stringify(truncate(f.text))} | ${boundary}${flag}`)
}
console.log(`[split] 重建 ${rebuilt.length} bytes · sha256 ${rebuiltSha}（源 ${sha(original)}）`)
console.log(`[split] 00-core 头 200 字符：${JSON.stringify(fragments[0].text.slice(0, 200))}`)
console.log(`[split] 999-footer 尾 200 字符：${JSON.stringify(fragments[fragments.length - 1].text.slice(-200))}`)

let baselineSha = null
if (fs.existsSync(BASELINE_SHA)) {
  baselineSha = fs.readFileSync(BASELINE_SHA, 'utf8').trim().split(/\s+/)[0]
  console.log(`[split] 基线 sha256 ${baselineSha} · ${baselineSha === rebuiltSha ? '一致' : '不一致（禁止落盘）'}`)
  if (baselineSha !== rebuiltSha) process.exit(1)
} else if (dryRun) {
  console.log(`[split] 基线缺失：${path.relative(ROOT, BASELINE_SHA)}（dry-run 继续；--write 必须先 capture-baseline）`)
}

if (dryRun) {
  console.log('[split] dry-run：未创建/覆盖任何文件；人工确认切点表后再 --write')
  process.exit(0)
}

if (!baselineSha) {
  console.error('[split] 拒绝落盘：缺基线 sha，无法证明字节等价')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 落盘：14 片 + MANIFEST（构建唯一真源）。不写 lib/client.js（由 build-client 负责）。
// ---------------------------------------------------------------------------
const manifest = fragments.map((f) => ({ file: f.file, responsibility: f.responsibility }))
fs.mkdirSync(SRC_DIR, { recursive: true })
for (const f of fragments) {
  const target = path.join(SRC_DIR, f.file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, Buffer.from(f.text, 'utf8'))
}
fs.writeFileSync(path.join(SRC_DIR, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`[split] 已写 ${fragments.length} 片 + MANIFEST.json 到 lib/client-src/（lib/client.js 未动）`)
