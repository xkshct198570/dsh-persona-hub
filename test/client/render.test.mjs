/**
 * 面板渲染契约（迷你 React 运行时 + 假 fetch）：真的把 Panel 跑起来并点按钮。
 *
 * 锁住：panel.tab 初始页签、设置卡 5 字段、开关变更 → POST /config（含 assets/panel）、
 * 「重新加载」→ POST /reload + 成功提示、缺资产顶部提示、加载失败错误态。
 * 不启动插件、不连真实后端；只执行 lib/client.js 的注册产物。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE = readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function createHarness() {
  let captured = null
  globalThis.window = {
    __ModuleLoader__: { load: (options) => { captured = options } },
    confirm: () => true,
  }
  let dirty = false
  const effects = new Map()
  const hookStores = new Map()
  const pending = []

  const createElement = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
  const depsEqual = (a, b) => Boolean(a && b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const React = {
    createElement,
    useState(init) {
      const slot = hookStores.get(React.__path) || { store: {}, cursor: 0 }
      hookStores.set(React.__path, slot)
      const index = React.__cursor++
      if (!(index in slot.store)) slot.store[index] = typeof init === 'function' ? init() : init
      return [slot.store[index], (next) => {
        slot.store[index] = typeof next === 'function' ? next(slot.store[index]) : next
        dirty = true
      }]
    },
    useRef(init) {
      const slot = hookStores.get(React.__path) || { store: {}, cursor: 0 }
      hookStores.set(React.__path, slot)
      const index = React.__cursor++
      if (!(index in slot.store)) slot.store[index] = { current: init }
      return slot.store[index]
    },
    useCallback(fn, deps) {
      const slot = hookStores.get(React.__path) || { store: {}, cursor: 0 }
      hookStores.set(React.__path, slot)
      const index = React.__cursor++
      const prev = slot.store[index]
      if (!prev || !depsEqual(prev.deps, deps)) slot.store[index] = { fn, deps }
      return slot.store[index].fn
    },
    useEffect(fn, deps) {
      const index = React.__cursor++
      const key = `${React.__path}#${index}`
      const prev = effects.get(key)
      if (prev && depsEqual(prev.deps, deps)) return
      const entry = { deps, fn, cleanup: prev && prev.cleanup }
      effects.set(key, entry)
      pending.push(entry)
    },
  }

  const state = {
    failConfig: false,
    posts: [],
    config: {
      dsh: { enabled: true, defaultPersona: 'bigfish' },
      bots: { 1127704268: { enabled: true, platform: 'qq',
        private: { enabled: true, defaultPersona: 'aluna', bindings: { 1246277257: 'aluna' } },
        group: { enabled: true, defaultPersona: '', bindings: {} } } },
      assets: { dir: '', effectiveDir: '/home/x/.dsh/persona-hub/prompts', watch: true, writable: true, writeReason: '' },
      panel: { allowRemote: false, pollMs: 60000, tab: 'bots' },
    },
  }
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
  globalThis.fetch = async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'POST') {
      state.posts.push({ url, body: JSON.parse(opts.body || '{}') })
      return json(200, { ok: true, memoryHinted: true, mirrorSynced: true })
    }
    if (url === '/persona-hub/api/personas') {
      return json(200, { ok: true, items: [
        { key: 'bigfish', name: '大肥鱼', avatar: '', chars: 100, origin: 'shipped', deletable: false },
        { key: 'aluna', name: '阿罗娜', avatar: '', chars: 50, origin: 'user', deletable: true },
      ], assets: state.config.assets })
    }
    if (url === '/persona-hub/api/config') {
      return state.failConfig ? json(500, { ok: false, error: 'boom' }) : json(200, { ok: true, config: state.config })
    }
    if (url.startsWith('/persona-hub/api/persona?')) {
      return json(200, { ok: true, key: 'bigfish', chars: 5, meta: { name: '大肥鱼', description: '默认' }, text: '正文' })
    }
    if (url.startsWith('/persona-hub/api/resolve?')) {
      return json(200, { ok: true, persona: null, reason: 'dsh_disabled', layer: 'dsh' })
    }
    return json(404, { ok: false, error: 'not_found' })
  }

  new Function('window', 'require', SOURCE)(globalThis.window, (id) => {
    if (id === 'react') return React
    throw new Error(`unexpected require ${id}`)
  })
  const dicts = []
  const registered = []
  const ctx = {
    effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
    locale: {
      register: (_ns, dict) => { dicts.push(dict); return () => {} },
      bind: () => (key, vars) => {
        const raw = (dicts[0] && dicts[0].zh && dicts[0].zh[key]) || key
        return String(raw).replace(/\{(\w+)\}/g, (_m, name) => (vars && vars[name] != null ? String(vars[name]) : `{${name}}`))
      },
    },
    slots: {
      inject: (_name, fn) => { fn(); return () => {} },
      register: (options, comp) => { registered.push({ options, comp }); return () => {} },
    },
  }
  captured.factory((id) => { if (id === 'react') return React; throw new Error(id) }).apply(ctx)
  const main = registered.find((entry) => entry.options.name === 'main')
  const t = main.options.inject().t

  const renderTree = () => {
    React.__path = 'r'
    React.__cursor = 0
    const renderNode = (node, keyPath) => {
      if (node == null || typeof node === 'boolean') return null
      if (typeof node === 'string' || typeof node === 'number') return { text: String(node) }
      if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${keyPath}[${index}]`)).filter(Boolean)
      if (!node.type) return null
      if (typeof node.type === 'function') {
        React.__path = `${keyPath}>${node.type.name || 'anon'}`
        React.__cursor = 0
        const props = { ...node.props, children: node.children.length === 1 ? node.children[0] : node.children }
        return renderNode(node.type(props), `${keyPath}>${node.type.name || 'anon'}`)
      }
      return { type: node.type, props: node.props, children: node.children.map((child, index) => renderNode(child, `${keyPath}.${index}`)).filter(Boolean) }
    }
    return renderNode(main.comp({ t }), 'r')
  }

  const walk = function* walk(node) {
    if (!node) return
    if (node.text !== undefined) { yield node; return }
    yield node
    for (const child of node.children || []) yield* walk(child)
  }
  const all = (tree, predicate) => [...walk(tree)].filter(predicate)
  const textOf = (tree) => all(tree, (node) => node.text !== undefined).map((node) => node.text).join('|')
  const buttons = (tree) => all(tree, (node) => node.type === 'button')
  const findByText = (tree, label) => buttons(tree).find((button) => button.children.some((child) => child.text === label))
  const findTab = (tree, label) => buttons(tree).find((button) => button.props.role === 'tab'
    && button.children.some((child) => child.text === label))

  let tree = null
  const settle = async () => {
    for (let pass = 0; pass < 40; pass += 1) {
      dirty = false
      pending.length = 0
      tree = renderTree()
      const queued = pending.splice(0)
      for (const entry of queued) {
        if (entry.cleanup) { try { entry.cleanup() } catch { /* noop */ } }
        entry.cleanup = entry.fn()
      }
      await sleep(6)
      if (!dirty) return tree
    }
    throw new Error('render did not settle')
  }

  /** 卸载：跑掉所有 effect cleanup（含 pollMs 的 setInterval），否则测试进程被定时器拖住。 */
  const dispose = () => {
    for (const entry of effects.values()) {
      if (entry.cleanup) { try { entry.cleanup() } catch { /* noop */ } }
      entry.cleanup = undefined
    }
    effects.clear()
  }

  return { state, tree: () => tree, settle, dispose, textOf, buttons, inputs: (t0) => all(t0, (n) => n.type === 'input' || n.type === 'select'), findByText, findTab }
}

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
