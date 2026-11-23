/**
 * 长列表滚动契约（R9-07）：页面只有一个纵向滚动根，资产列表不再被宿主裁掉底部。
 *
 * 与 client.test.mjs 同风格：只读 lib/client.js 源码做结构断言，不启动插件、不用 jsdom。
 * 真浏览器五步（1280×800 / 390×844）不在本文件覆盖，必须厂长目视。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')

function sliceFrom(name, nextMarker) {
  const start = CLIENT.indexOf(name)
  assert.ok(start >= 0, `找不到 ${name}`)
  const end = CLIENT.indexOf(nextMarker, start)
  assert.ok(end > start, `${name} 缺少结束边界 ${nextMarker}`)
  return CLIENT.slice(start, end)
}

const pageCss = () => sliceFrom('      page: {', '      pageHead: {')
const scrollProps = () => sliceFrom('    function scrollRegionProps(t) {', '    function Panel({ t }) {')
const injector = () => sliceFrom('    function injectScrollbarStyle() {', '    /**\n     * 页根键盘滚动')
const keys = () => sliceFrom('    function onScrollRegionKeys(event) {', '    /**\n     * 页根滚动契约属性')

test('页根是唯一纵向滚动根：flex 1 1 auto + minHeight 0 + overflowY auto', () => {
  const css = pageCss()
  assert.match(css, /flex: '1 1 auto'/, '页根未取满宿主剩余高度（flex 1 1 auto）')
  assert.match(css, /minHeight: 0/, '页根缺 minHeight:0，flex 子项无法收缩成滚动容器')
  assert.match(css, /overflowY: 'auto'/, '页根未自建纵向滚动（宿主 centerCol 是 overflow:hidden）')
  assert.doesNotMatch(css, /minHeight: '100%'/, '页根仍是 minHeight:100%（会被裁、底部不可达）')
  assert.match(css, /scrollbarWidth: 'thin'/, '页根缺细滚动条')
  assert.match(css, /scrollbarColor: 'var\(--dsw-alias-border-l1\) transparent'/, '页根缺主题色滚动条')
})

test('四个加载态出口与主出口都套同一页根契约', () => {
  const hits = CLIENT.match(/style: css\.page, \.\.\.scrollRegionProps\(t\)/g) || []
  assert.equal(hits.length, 4, `页根出口应全部套滚动契约（当前 ${hits.length} 处）`)
  assert.equal((CLIENT.match(/style: css\.page \}/g) || []).length, 0, '仍有未套契约的 css.page 页根')
})

test('页根声明 data-wm-scroll=page，键盘可聚焦且 role/aria 齐全', () => {
  const props = scrollProps()
  assert.match(props, /tabIndex: 0/, '页根不可聚焦，PageDown/Home/End 收不到键')
  assert.match(props, /role: 'region'/, '页根缺 region 语义')
  assert.match(props, /'aria-label': t\('page\.title'\)/, '页根缺 aria-label（复用页面标题，不新增键）')
  assert.match(props, /'data-wm-scroll': 'page'/, '页根缺纵向滚动标记')
  assert.match(props, /onKeyDown: \(event\) => onScrollRegionKeys\(event\)/, '页根未接键盘滚动')
})

test('页根键盘：PageUp/PageDown/Home/End，输入控件不接管', () => {
  const handler = keys()
  for (const key of ['PageDown', 'PageUp', 'Home', 'End']) {
    assert.ok(handler.includes(`'${key}'`), `缺 ${key} 处理`)
  }
  assert.match(handler, /preventDefault\(\)/, '键盘滚动未阻止默认行为')
  assert.match(handler, /tag === 'input' \|\| tag === 'textarea' \|\| tag === 'select'/, '输入控件里的 Home/End 被劫持')
})

test('滚动条样式只注入一次 ::-webkit-scrollbar{width:8px}', () => {
  assert.equal((CLIENT.match(/::-webkit-scrollbar/g) || []).length, 1, 'webkit 滚动条样式只能注入一处')
  assert.ok(CLIENT.includes("'::-webkit-scrollbar{width:8px}'"), '缺 8px 细滚动条样式')
  const fn = injector()
  assert.match(fn, /getElementById\(SCROLLBAR_STYLE_ID\)/, '重复装载未按 id 判重，会叠加 <style>')
  assert.match(fn, /style\.id = SCROLLBAR_STYLE_ID/, '注入的 <style> 没有可判重的 id')
  assert.match(fn, /typeof document === 'undefined'/, '无 document 时未静默跳过')
  assert.ok(CLIENT.includes('injectScrollbarStyle()'), '注入函数未接线')
  assert.ok(CLIENT.includes("'dsh-scroll-contract'"), '未复用统一 style id（与鲸忆同 id 才能互相判重）')
})

test('资产列表不设高：纵向交给页根，底部可达', () => {
  const list = sliceFrom('      assetList: {', '      assetItem: {')
  assert.doesNotMatch(list, /maxHeight|overflow/, '资产列表自建滚动/限高会再次裁掉底部')
  assert.doesNotMatch(pageCss(), /overflowY: 'hidden'/, '页根禁止裁掉纵向内容')
})
