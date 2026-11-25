#!/usr/bin/env node
/**
 * 客户端构建（人设仓）：按 lib/client-src/MANIFEST.json 的顺序逐字节拼接成 lib/client.js。
 *
 * 为什么不引 bundler：DSH 只加载单文件 bundle，源片段是同一 factory 作用域内的文本；
 * 构建只做“读片段 → 拼接 → 语法预检 → 原子写”。不加头尾/分隔符/编码转换。
 * 产物 lib/client.js 入库；`--check` 只读比较，是 pretest/发布前的过期与手改闸。
 *
 * 两个阶段口径（P5a1 先骨架、P5a2 才动字节）：
 * - 有 MANIFEST：按片段重建并与产物逐字节对拍（或原子写）。
 * - 无 MANIFEST（P5a1）：`--check` 退化为「现产物 sha256 == 基线 client.sha256.p5a」断言；
 *   基线缺失一律 FAIL，不静默跳过；此时拒绝写产物（还没源可建，不伪造重建）。
 *
 * 用法：
 *   node scripts/build-client.mjs            # 重建产物（原子写；无 MANIFEST 时拒绝）
 *   node scripts/build-client.mjs --check    # 只读校验
 *
 * 依赖方向：scripts → acorn + lib/client-src/MANIFEST.json + scripts/baseline/persona/**；
 * 不 import 业务代码。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as acorn from 'acorn'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = path.join(ROOT, 'lib/client-src')
const MANIFEST = path.join(SRC_DIR, 'MANIFEST.json')
const OUTPUT = path.join(ROOT, 'lib/client.js')
const BASELINE_SHA = path.join(ROOT, 'scripts/baseline/persona/client.sha256.p5a')
const ACORN_EXPECTED = '8.14.0'

const args = process.argv.slice(2)
const unknown = args.filter((a) => a !== '--check')
if (unknown.length) {
  console.error(`[build] 未知参数：${unknown.join(' ')}（只支持 --check）`)
  process.exit(2)
}
const check = args.includes('--check')

if (acorn.version !== ACORN_EXPECTED) {
  console.error(`[build] acorn 版本不符：期望 ${ACORN_EXPECTED}，实际 ${acorn.version}（钉死依赖，防解析行为漂移）`)
  process.exit(1)
}

/** @param {Buffer|string} data @returns {string} sha256 hex */
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex')

/**
 * 读基线 sha 文件（格式 `<64 hex>  lib/client.js`）。
 * @param {string} file 绝对路径
 * @returns {string} 基线 sha256
 */
function readBaselineSha(file) {
  if (!fs.existsSync(file)) {
    console.error(`[build] 缺少基线 ${path.relative(ROOT, file)}；先跑 node scripts/capture-baseline.mjs --phase P5a`)
    process.exit(1)
  }
  const line = fs.readFileSync(file, 'utf8').split(/\r?\n/, 1)[0]
  const match = /^([0-9a-f]{64})  lib\/client\.js$/.exec(line)
  if (!match) {
    console.error(`[build] 基线首行格式非法：${JSON.stringify(line.slice(0, 96))}`)
    process.exit(1)
  }
  return match[1]
}

// ---------------------------------------------------------------------------
// P5a1：无 MANIFEST —— 产物不可重建，--check 只做基线 sha 断言（不是跳过）。
// ---------------------------------------------------------------------------
if (!fs.existsSync(MANIFEST)) {
  const baselineSha = readBaselineSha(BASELINE_SHA)
  if (!fs.existsSync(OUTPUT)) {
    console.error(`[build] 产物不存在：${path.relative(ROOT, OUTPUT)}`)
    process.exit(1)
  }
  const currentSha = sha(fs.readFileSync(OUTPUT))
  if (currentSha !== baselineSha) {
    console.error(`[build] FAIL：产物 sha ${currentSha} != 基线 ${baselineSha}（P5a1 产物必须零变化）`)
    process.exit(1)
  }
  if (!check) {
    console.error('[build] 拒绝写：P5a1 尚无 lib/client-src/MANIFEST.json，产物只能由基线 sha 断言，不能凭空重建')
    process.exit(1)
  }
  console.log(`[build] ok（P5a1 基线断言）：lib/client.js sha256 ${currentSha}`)
  process.exit(0)
}

/**
 * 读 MANIFEST 并校验形状：构建唯一真源，缺项/路径越界一律停。
 * @returns {{file: string, responsibility: string}[]} 清单
 */
function readManifest() {
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  } catch (err) {
    console.error(`[build] MANIFEST.json 解析失败：${err.message}`)
    process.exit(1)
  }
  if (!Array.isArray(manifest) || manifest.length === 0) {
    console.error('[build] MANIFEST.json 必须是非空数组')
    process.exit(1)
  }
  const seen = new Set()
  for (const [i, entry] of manifest.entries()) {
    if (!entry || typeof entry.file !== 'string' || typeof entry.responsibility !== 'string') {
      console.error(`[build] MANIFEST 第 ${i + 1} 项必须含 file/responsibility 字符串`)
      process.exit(1)
    }
    if (entry.file.startsWith('/') || entry.file.includes('..') || entry.file.includes('\\')) {
      console.error(`[build] MANIFEST 路径必须是 lib/client-src/ 内相对 POSIX 路径：${entry.file}`)
      process.exit(1)
    }
    if (seen.has(entry.file)) {
      console.error(`[build] MANIFEST 重复文件：${entry.file}`)
      process.exit(1)
    }
    seen.add(entry.file)
  }
  return manifest
}

const manifest = readManifest()
const parts = []
for (const entry of manifest) {
  const file = path.join(SRC_DIR, entry.file)
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    console.error(`[build] 片段不存在：${entry.file}`)
    process.exit(1)
  }
  parts.push({ file: entry.file, buf: fs.readFileSync(file) })
}
const built = Buffer.concat(parts.map((p) => p.buf))
const text = built.toString('utf8')

// 语法预检：只编译不执行；失败绝不写盘。
try {
  new Function(text) // eslint-disable-line no-new-func
} catch (err) {
  console.error(`[build] 拼接产物语法预检失败：${err.message}`)
  process.exit(1)
}

/**
 * 顶层声明唯一性：只对完整拼接产物查一次，不要求片段独立可解析。
 * @param {string} code 完整拼接文本
 * @returns {string[]} 重复声明描述（空数组=通过）
 */
function duplicateTopLevelDeclarations(code) {
  let ast
  try {
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true })
  } catch (err) {
    return [`完整产物 acorn 解析失败：${err.message}`]
  }
  const call = ast.body.find((n) => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression')
  const obj = call && call.expression.arguments[0]
  const factoryProp = obj && obj.type === 'ObjectExpression'
    ? obj.properties.find((p) => (p.key.name || p.key.value) === 'factory')
    : null
  const factory = factoryProp && factoryProp.value
  const body = factory && factory.body && factory.body.type === 'BlockStatement' ? factory.body.body : null
  if (!body) return ['完整产物里找不到 factory 块体，无法查顶层声明唯一性']
  const names = new Map()
  const add = (name, type) => names.set(name, [...(names.get(name) || []), type])
  for (const node of body) {
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) if (decl.id.type === 'Identifier') add(decl.id.name, node.type)
    } else if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) {
      add(node.id.name, node.type)
    }
  }
  return [...names.entries()]
    .filter(([, types]) => types.length > 1)
    .map(([name, types]) => `${name} 重复声明 ${types.length} 次（${types.join('/')}）`)
}
const duplicates = duplicateTopLevelDeclarations(text)
if (duplicates.length) {
  console.error(`[build] 顶层声明重复：${duplicates.join('；')}`)
  process.exit(1)
}

const builtSha = sha(built)
if (check) {
  if (!fs.existsSync(OUTPUT)) {
    console.error(`[build] 产物不存在：${path.relative(ROOT, OUTPUT)}`)
    process.exit(1)
  }
  const current = fs.readFileSync(OUTPUT)
  if (Buffer.compare(current, built) !== 0) {
    console.error(`[build] FAIL：产物与源拼接不一致（产物 ${sha(current)} / 重建 ${builtSha}，${current.length} vs ${built.length} bytes）`)
    console.error('[build] 产物勿手改；先修源片段/生成器，再重建。')
    process.exit(1)
  }
  console.log(`[build] ok：${manifest.length} 片 → lib/client.js ${built.length} bytes，sha256 ${builtSha}`)
  process.exit(0)
}

// 原子写：同目录 tmp + rename，避免半截产物被 DSH 加载。
const tmp = path.join(path.dirname(OUTPUT), `.client.js.tmp-${process.pid}`)
fs.writeFileSync(tmp, built)
fs.renameSync(tmp, OUTPUT)
console.log(`[build] 已写 lib/client.js：${manifest.length} 片 → ${built.length} bytes，sha256 ${builtSha}`)
