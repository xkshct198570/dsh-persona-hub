/**
 * 面板渲染契约（迷你 React 运行时 + 假 fetch）：真的把 Panel 跑起来并点按钮。
 *
 * 锁住：panel.tab 初始页签、设置卡 5 字段、开关变更 → POST /config（含 assets/panel）、
 * 「重新加载」→ POST /reload + 成功提示、缺资产顶部提示、加载失败错误态。
 * 不启动插件、不连真实后端；只执行 lib/client.js 的注册产物。
 * 运行时夹具在 ./harness.mjs（三页签冒烟 tabs.test.mjs 复用同一夹具）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

test('面板渲染：初始页签取 panel.tab、设置卡 5 字段、开关保存带 assets/panel', async () => {
  const h = createHarness()
  try {
  await h.settle()
  let text = h.textOf(h.tree())
  assert.ok(text.includes('角色与资产') && text.includes('主体与通道') && text.includes('调试与设置'), '三页签标签缺失')
  const selected = h.buttons(h.tree()).filter((button) => button.props['aria-selected'] === 'true')
  assert.equal(selected.length, 1)
  assert.equal(selected[0].children.map((child) => child.text).join(''), '主体与通道', 'panel.tab=bots 必须作初始页签')
  assert.ok(text.includes('1127704268'), '主体页应列出已配置 bot')

  h.findTab(h.tree(), '调试与设置').props.onClick()
  await h.settle()
  text = h.textOf(h.tree())
  assert.ok(text.includes('设置（资产与面板）'), '设置卡缺失')
  assert.ok(text.includes('默认: /home/x/.dsh/persona-hub/prompts'), 'assets.dir 应显示实际默认路径')
  assert.ok(text.includes('生效: 重挂') && text.includes('生效: 即时'), '生效语义缺失')
  const numberInput = h.inputs(h.tree()).find((node) => node.props.type === 'number')
  assert.ok(numberInput, 'pollMs 数值输入缺失')
  assert.equal(String(numberInput.props.value), '60000')

  // 开关保存：allowRemote=true → 保存 → POST 带 panel/assets
  const allowSwitch = h.buttons(h.tree()).find((b) => b.props['aria-label'] === '允许远程访问')
  assert.ok(allowSwitch, 'allowRemote 开关缺失')
  allowSwitch.props.onClick()
  await h.settle()
  h.findByText(h.tree(), '保存').props.onClick()
  await h.settle()
  const posted = h.state.posts.find((entry) => entry.url === '/persona-hub/api/config')
  assert.ok(posted, '保存未 POST /config')
  assert.equal(posted.body.config.panel.allowRemote, true)
  assert.equal(posted.body.config.panel.pollMs, 60000)
  assert.ok(posted.body.config.assets && typeof posted.body.config.assets.dir === 'string')
  } finally { h.dispose() }
})

test('面板渲染：重新加载、缺资产提示、加载失败重试', async () => {
  const h = createHarness()
  try {
  await h.settle()
  const reload = h.findByText(h.tree(), '重新加载')
  assert.ok(reload, '重新加载按钮缺失')
  reload.props.onClick()
  await h.settle()
  assert.ok(h.state.posts.some((entry) => entry.url === '/persona-hub/api/reload'), 'POST /reload 未调用')
  assert.ok(h.textOf(h.tree()).includes('已重新读取人设资产'), '重载成功提示缺失')

  h.state.config = { ...h.state.config, dsh: { enabled: true, defaultPersona: 'ghost' } }
  h.findByText(h.tree(), '刷新').props.onClick()
  await h.settle()
  assert.match(h.textOf(h.tree()), /配置指向缺失角色：ghost/, '缺资产顶部提示缺失')

  h.state.config = { ...h.state.config, dsh: { enabled: true, defaultPersona: 'bigfish' } }
  h.state.failConfig = true
  h.findByText(h.tree(), '刷新').props.onClick()
  await h.settle()
  assert.match(h.textOf(h.tree()), /加载失败：boom/, '错误态文案缺失')
  assert.ok(h.findByText(h.tree(), '重试'), '错误态应可重试')
  } finally { h.dispose() }
})

test('面板空态：资产与主体都为空 + 资产目录指到出厂目录（只读原因如实显示）', async () => {
  const h = createHarness()
  try {
    h.state.personas = []
    h.state.config = {
      dsh: { enabled: true, defaultPersona: '' },
      bots: {},
      assets: { dir: '', effectiveDir: '/pkg/personas/prompts', watch: false, writable: false, writeReason: 'is_shipped' },
      panel: { allowRemote: false, pollMs: 60000, tab: 'personas' },
    }
    await h.settle()
    let text = h.textOf(h.tree())
    assert.ok(text.includes('资产为空。'), '角色页空态缺失')
    assert.ok(text.includes('资产目录不可写（资产目录是插件出厂目录（只读））'), '只读原因未映射 is_shipped')
    const importBtn = h.buttons(h.tree()).find((b) => b.children.some((c) => c.text === '导入人设'))
    assert.ok(importBtn && importBtn.props.disabled, '出厂目录必须禁用导入')

    h.findTab(h.tree(), '主体与通道').props.onClick()
    await h.settle()
    text = h.textOf(h.tree())
    assert.ok(text.includes('还没有主体。在下面添加一个 bot id。'), '主体页空态缺失')
    assert.ok(text.includes('暂无绑定，按默认角色处理。') === false, '无主体时不应出现通道绑定空态')
  } finally { h.dispose() }
})

test('面板渲染：保存回读失败显示「已保存·回读失败」，不复用「保存失败」', async () => {
  const h = createHarness()
  try {
    await h.settle()
    // 设置卡在「调试与设置」页签，allowRemote 开关在那里。
    h.findTab(h.tree(), '调试与设置').props.onClick()
    await h.settle()
    h.state.postResult = {
      ok: true, memoryHinted: true, mirrorSynced: true, readBackFailed: true, readBackReason: 'read_failed',
    }
    // 制造未保存修改（保存按钮 !dirty 时禁用）。
    h.buttons(h.tree()).find((b) => b.props['aria-label'] === '允许远程访问').props.onClick()
    await h.settle()
    h.findByText(h.tree(), '保存').props.onClick()
    await h.settle()
    const text = h.textOf(h.tree())
    assert.ok(text.includes('已保存·回读失败，重启后以文件为准'), '回读失败提示缺失')
    assert.equal(text.includes('保存失败'), false, '回读失败不得复用「保存失败」文案')
  } finally { h.dispose() }
})

test('面板渲染：写盘失败仍显示保存失败（反向用例）', async () => {
  const h = createHarness()
  try {
    await h.settle()
    h.findTab(h.tree(), '调试与设置').props.onClick()
    await h.settle()
    h.state.failPost = true
    h.buttons(h.tree()).find((b) => b.props['aria-label'] === '允许远程访问').props.onClick()
    await h.settle()
    h.findByText(h.tree(), '保存').props.onClick()
    await h.settle()
    const text = h.textOf(h.tree())
    assert.match(text, /保存失败：/, '真失败必须显示保存失败')
    assert.equal(text.includes('已保存·回读失败'), false, '真失败不得显示回读失败提示')
  } finally { h.dispose() }
})
