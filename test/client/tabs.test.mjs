/**
 * 三页签渲染冒烟（P5c）：把 Panel 在 personas / bots / debug 三个初始页签各渲染一次，
 * 断言选中态唯一、页签专属内容出现、来回切页签不抛错/不白屏。
 *
 * 为什么单独覆盖：client 已按字节拆成多个片段，三个页签的返回片段分别落在
 * 50-personas / 60-bots-02 / 70-debug 片里；此用例是拆分后的定向回归（字节闸之外的行为证据）。
 *
 * 职责与依赖方向：只读 lib/client.js 产物；运行时夹具复用 ./harness.mjs，不 import src/ 业务代码。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

const TABS = [
  { tab: 'personas', label: '角色与资产', marker: '大肥鱼' },
  { tab: 'bots', label: '主体与通道', marker: '1127704268' },
  { tab: 'debug', label: '调试与设置', marker: '路由调试' },
]

test('三页签渲染冒烟：选中态唯一 + 页签专属内容 + 互切不抛错', async () => {
  for (const { tab, label, marker } of TABS) {
    const h = createHarness()
    try {
      h.state.config = { ...h.state.config, panel: { ...h.state.config.panel, tab } }
      await h.settle()
      const selected = h.buttons(h.tree()).filter((button) => button.props['aria-selected'] === 'true')
      assert.equal(selected.length, 1, `${tab}: 选中页签应唯一`)
      assert.equal(selected[0].children.map((child) => child.text).join(''), label, `${tab}: 初始页签不符 panel.tab`)
      assert.ok(h.textOf(h.tree()).includes(marker), `${tab}: 页签专属内容缺失（${marker}）`)
      for (const other of TABS) {
        if (other.tab === tab) continue
        h.findTab(h.tree(), other.label).props.onClick()
        await h.settle()
        assert.ok(h.textOf(h.tree()).includes(other.marker), `${tab}→${other.tab}: 切页签后内容缺失`)
      }
    } finally {
      h.dispose()
    }
  }
})
