#!/usr/bin/env node
/**
 * 资产迁移：旧平铺布局 → prompts/ 正文 + meta.json 元数据。
 *
 * 旧：<root>/*.txt（默认 $DSH_HOME/persona-hub/personas）
 * 新：<root>/prompts/<key>.txt + <root>/meta.json（用户覆盖出厂）
 *
 * 默认 dry-run；--apply 才落盘（先做目录快照，逐字节搬并核对 sha256）。
 * 幂等：已在 prompts/ 的 key 跳过；meta 只补缺 key，不覆盖用户字段。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const rootArg = argv.find((a) => a.startsWith('--dir='))
const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const root = rootArg ? rootArg.slice('--dir='.length) : join(HOME, 'persona-hub', 'personas')
const prompts = join(root, 'prompts')
const metaPath = join(root, 'meta.json')
const DEFAULTS = {
  bigfish: { name: '大肥鱼', avatar: '' },
  aluna: { name: '阿罗娜', avatar: '' },
  yiyi: { name: '一叶', avatar: '' },
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex')

function main() {
  if (!existsSync(root)) { console.log(`[migrate-assets] root 不存在，无事可做：${root}`); return }
  const files = readdirSync(root).filter((f) => f.endsWith('.txt'))
  console.log(`[migrate-assets] root=${root} 计划迁移 ${files.length} 个正文（${apply ? 'APPLY' : 'dry-run'}）`)
  if (!apply) { for (const f of files) console.log(`  - ${f} → prompts/${f}`); return }

  const backup = join(HOME, 'persona-hub', 'backup', `personas-${Date.now()}`)
  mkdirSync(backup, { recursive: true, mode: 0o700 })
  for (const f of readdirSync(root)) if (f.endsWith('.txt')) copyFileSync(join(root, f), join(backup, f))
  console.log(`[migrate-assets] 快照 -> ${backup}`)

  mkdirSync(prompts, { recursive: true, mode: 0o700 })
  for (const f of files) {
    const src = join(root, f)
    const dst = join(prompts, f)
    const before = sha(readFileSync(src))
    if (existsSync(dst)) { console.log(`  = ${f} 已在新位置，跳过`); continue }
    renameSync(src, dst)
    const after = sha(readFileSync(dst))
    if (before !== after) throw new Error(`sha256 不一致：${f}`)
    console.log(`  ✓ ${f} sha256=${after.slice(0, 16)}…`)
  }

  let meta = {}
  try { meta = JSON.parse(readFileSync(metaPath, 'utf8')) } catch { meta = {} }
  let added = 0
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (!meta[k]) { meta[k] = v; added += 1 }
  }
  meta.version = meta.version || 1
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  console.log(`[migrate-assets] meta 补 ${added} key -> ${metaPath}`)
}

try { main() } catch (err) { console.error('[migrate-assets] 失败：', err?.message || err); process.exit(1) }
