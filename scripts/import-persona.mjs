#!/usr/bin/env node
/**
 * 把外部人设文本导入 persona-hub 数据目录（迁移用；不写仓库、不写记忆库）。
 *
 * 用法：node scripts/import-persona.mjs <src.txt> [key]
 * key 默认 bigfish；目录 0700、文件 0600。
 */
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { resolvePersonaDir, KEY_RE } from '../src/host/persona-store.js'

const [src, key = 'bigfish'] = process.argv.slice(2)
if (!src) { console.error('usage: node scripts/import-persona.mjs <src.txt> [key]'); process.exit(2) }
if (!KEY_RE.test(key)) { console.error('[import-persona] invalid key'); process.exit(2) }

const text = readFileSync(src, 'utf8').replace(/^\uFEFF/, '')
const dir = resolvePersonaDir({})
mkdirSync(dir, { recursive: true, mode: 0o700 })
const out = join(dir, `${key}.txt`)
writeFileSync(out, text, { encoding: 'utf8', mode: 0o600 })
chmodSync(out, 0o600)
console.log(`[import-persona] ok key=${key} chars=${text.length} -> ${out}`)
