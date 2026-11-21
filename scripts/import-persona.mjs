#!/usr/bin/env node
/**
 * CLI 导入人设（给不爱用面板的用户）：node scripts/import-persona.mjs <src.txt> [key] [name]
 * 产物：$DSH_HOME/persona-hub/prompts/<key>.txt + meta.json 的 name/avatar 条目。
 * 与面板「导入人设」走同一实现（persona-admin.importPersona），不复制逻辑。
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { importPersona } from '../src/host/persona-admin.js'

const [src, keyArg, nameArg] = process.argv.slice(2)
if (!src) { console.error('usage: node scripts/import-persona.mjs <src.txt> [key] [name]'); process.exit(2) }
const key = keyArg || basename(src).replace(/\.txt$/i, '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 32)
const text = readFileSync(src, 'utf8')
const got = importPersona({}, { key, name: nameArg || key, text, overwrite: true })
if (!got.ok) { console.error('[import-persona]', got.error); process.exit(1) }
console.log(`[import-persona] ok key=${got.key} chars=${got.chars}`)
