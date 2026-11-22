import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

test('manifest：包名/版本/engines/patch 就位', () => {
  assert.equal(pkg.name, 'dsh-persona-hub')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.match(pkg.engines.dsh, /^>=/)
  assert.equal(pkg.private, undefined)
  assert.ok(existsSync(join(root, pkg.dsh.bundle.patch)))
})

test('exports：入口与 client 产物存在', () => {
  assert.ok(existsSync(join(root, 'index.js')))
  assert.ok(existsSync(join(root, 'lib/client.js')))
  assert.equal(pkg.exports['./client'], './lib/client.js')
})

test('patch：恰一行 insert（id=persona-hub）', () => {
  const yaml = readFileSync(join(root, pkg.dsh.bundle.patch), 'utf8')
  assert.equal((yaml.match(/- insert:/g) || []).length, 1)
  assert.match(yaml, /id: persona-hub/)
})

test('市场元数据：zh/en meta 三字段齐全，detail 是带图与文字说明的包内文档', () => {
  const locales = Object.fromEntries(['zh', 'en'].map((lang) => [
    lang, JSON.parse(readFileSync(join(root, 'locale', `${lang}.json`), 'utf8')),
  ]))
  for (const lang of ['zh', 'en']) {
    const meta = locales[lang].meta
    assert.ok(meta, `${lang}.meta 缺失`)
    assert.equal(typeof meta.title, 'string')
    assert.ok(meta.title.trim() !== '', `${lang}.meta.title 为空`)
    assert.ok(meta.description.trim() !== '', `${lang}.meta.description 为空`)
    assert.match(meta.detail, /^docs\/[a-z0-9._-]+\.md$/i, `${lang}.meta.detail 必须落在 docs/ 下`)
    const file = join(root, meta.detail)
    assert.ok(existsSync(file), `${lang}.meta.detail 文件不存在：${meta.detail}`)
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim() !== '')
    assert.ok(lines.length >= 3, `${meta.detail} 至少要有特性图 + 功能说明，不能只剩一行`)
    assert.match(lines[0], /^!\[.+\]\(preview\.svg\)$/, `${meta.detail} 首行必须是带替代文本的 preview.svg 特性图`)
  }
  assert.equal(locales.zh.meta.detail, 'docs/DETAIL.zh.md', '中文必须指向中文详情文档')
  assert.equal(locales.en.meta.detail, 'docs/DETAIL.md')
  assert.ok(pkg.files.includes('docs'), 'files 必须包含 docs/')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'), 'client 必须注入 locale 包')
})
