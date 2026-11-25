#!/usr/bin/env node
/**
 * i18n 校验/生成（P5b 形态）：locale/{zh,en}.json 是唯一真源；
 * 生成块落 lib/client-src/generated/locale.js（单行 dict + 起止标记），
 * 再由 scripts/build-client.mjs 按 MANIFEST 拼成 lib/client.js（禁止手改产物与生成块）。
 *
 * 用法：
 *   node scripts/i18n-check.mjs          # 默认 --check：键集/空值/占位符一致 + 生成块与 JSON 逐字一致
 *   node scripts/i18n-check.mjs --write  # 从 JSON 重生成 lib/client-src/generated/locale.js
 *
 * 依赖方向：scripts → node 原生模块 + locale/*.json；不 import 业务代码。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LANGS = ['zh', 'en']
const GENERATED = path.join(ROOT, 'lib/client-src/generated/locale.js')
const MARK_START = '// >>> locale:generated（由 scripts/i18n-check.mjs --write 生成，勿手改）'
const MARK_END = '// <<< locale:generated'
/** 生成块前的分节 banner（与 20-normalize.js 的分节风格一致）。 */
const HEADER = '    // ---------------------------------------------------------------- 文案（唯一真源：locale/*.json）'

const args = process.argv.slice(2)
const write = args.includes('--write')
const unknown = args.filter((arg) => arg !== '--write' && arg !== '--check')
if (unknown.length > 0) {
  console.error(`[i18n] 未知参数：${unknown.join(' ')}（只支持 --check / --write）`)
  process.exit(2)
}

/**
 * 把 locale JSON 的嵌套结构平铺成客户端 `t()` 用的点号键（meta.title 等）。
 * @param {Record<string, unknown>} node locale JSON 节点
 * @param {string} [prefix] 前缀
 * @returns {Record<string, string>} 平铺键值
 */
function flatten(node, prefix = '') {
  const out = {}
  for (const [key, value] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(out, flatten(value, dotted))
    else out[dotted] = value
  }
  return out
}

/**
 * 读取并平铺一份 locale JSON。
 * @param {string} lang 语言代码
 * @returns {Record<string, string>} 平铺键值
 */
function readLocale(lang) {
  const file = path.join(ROOT, 'locale', `${lang}.json`)
  try {
    return flatten(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (err) {
    console.error(`[i18n] 读取 ${path.relative(ROOT, file)} 失败：${err.message}`)
    process.exit(1)
  }
}

const dicts = Object.fromEntries(LANGS.map((lang) => [lang, readLocale(lang)]))
const problems = []

// ① 键集完全一致。
const zhKeys = new Set(Object.keys(dicts.zh))
for (const lang of LANGS.slice(1)) {
  const keys = new Set(Object.keys(dicts[lang]))
  const missing = [...zhKeys].filter((key) => !keys.has(key))
  const extra = [...keys].filter((key) => !zhKeys.has(key))
  if (missing.length > 0) problems.push(`${lang} 缺少 ${missing.length} 个键：${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''}`)
  if (extra.length > 0) problems.push(`${lang} 多出 ${extra.length} 个键：${extra.slice(0, 12).join(', ')}${extra.length > 12 ? ' …' : ''}`)
}

// ② 不许空值。
for (const lang of LANGS) {
  for (const [key, value] of Object.entries(dicts[lang])) {
    if (typeof value !== 'string' || value.trim() === '') problems.push(`${lang} 的 ${key} 为空或非字符串`)
  }
}

// ③ 占位符集合一致（同一个键在两种语言里必须使用相同的 {name}）。
const placed = /\{([A-Za-z0-9_]+)\}/g
/**
 * 提取字符串里的 {name} 占位符集合。
 * @param {string} value 文案
 * @returns {Set<string>} 占位符名
 */
function placeholderSet(value) {
  const set = new Set()
  if (typeof value !== 'string') return set
  for (const match of value.matchAll(placed)) set.add(match[1])
  return set
}
const sharedKeys = [...zhKeys].filter((key) => LANGS.every((lang) => Object.prototype.hasOwnProperty.call(dicts[lang], key)))
for (const key of sharedKeys) {
  const reference = placeholderSet(dicts.zh[key])
  const refText = [...reference].sort().join(',')
  for (const lang of LANGS.slice(1)) {
    const got = [...placeholderSet(dicts[lang][key])].sort().join(',')
    if (got !== refText) problems.push(`${key} 的占位符不一致：zh={${refText}} ${lang}={${got}}`)
  }
}

if (problems.length > 0) {
  console.error('[i18n] 校验失败：')
  for (const line of problems) console.error(`  - ${line}`)
  process.exit(1)
}

/**
 * 生成块期望内容（与 --write 逐字一致）：banner + 起止标记 + 单行 dict。
 * 单行是为了让生成块只占一个物理行，避免 320 行字典把 client 片段顶到体量阈值。
 * @returns {string} 期望文本
 */
function expectedBlock() {
  return `${HEADER}\n\n    ${MARK_START}\n    const dict = ${JSON.stringify(dicts)}\n    ${MARK_END}\n`
}

const expected = expectedBlock()

if (write) {
  fs.mkdirSync(path.dirname(GENERATED), { recursive: true })
  const tmp = path.join(path.dirname(GENERATED), `.locale.js.tmp-${process.pid}`)
  fs.writeFileSync(tmp, expected)
  fs.renameSync(tmp, GENERATED)
  console.log(`[i18n] 已生成 ${path.relative(ROOT, GENERATED)}（${LANGS.join('/')} 各 ${zhKeys.size} 键，单行 dict）。`)
  process.exit(0)
}

let actual
try {
  actual = fs.readFileSync(GENERATED, 'utf8')
} catch (err) {
  console.error(`[i18n] 读取 ${path.relative(ROOT, GENERATED)} 失败：${err.message}；先跑 node scripts/i18n-check.mjs --write`)
  process.exit(1)
}

if (actual !== expected) {
  console.error(`[i18n] ${path.relative(ROOT, GENERATED)} 与 locale JSON 生成的期望内容不一致；运行 node scripts/i18n-check.mjs --write 重生成。`)
  process.exit(1)
}
console.log(`[i18n] ok：${LANGS.join('/')} 各 ${zhKeys.size} 键，占位符一致，${path.relative(ROOT, GENERATED)} 与 JSON 逐字一致。`)
