/**
 * dsh-persona-hub Client 半（S1）：角色资产列表 / 预览 / 设为网页默认。
 * 只做展示与选择；注入由 Host 的 systemPrompt.section 完成。
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-hub',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React
    const NS = 'dsh-persona-hub'
    const PANEL_ID = 'persona-hub'
    const API = '/persona-hub/api'
    const dict = {
      zh: { meta: { title: '双人设与角色', description: '角色资产库与网页端角色切换' } },
      en: { meta: { title: 'Persona Hub', description: 'Persona library and web role switching' } },
    }
    async function getJson(url, opts) {
      const res = await fetch(url, opts)
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`)
      return body
    }
    function Panel() {
      const [items, setItems] = useState([])
      const [active, setActive] = useState('')
      const [text, setText] = useState('')
      const [err, setErr] = useState('')
      async function load() {
        setErr('')
        try {
          const b = await getJson(`${API}/personas`)
          setItems(b.items || []); setActive(b.active || '')
          if (b.active) await preview(b.active)
        } catch (e) { setErr(e.message) }
      }
      async function preview(key) {
        setErr('')
        try {
          const b = await getJson(`${API}/persona?key=${encodeURIComponent(key)}`)
          setText(b.text || '')
        } catch (e) { setErr(e.message) }
      }
      async function select(key) {
        setErr('')
        try {
          const b = await getJson(`${API}/select`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key }),
          })
          setActive(b.key)
        } catch (e) { setErr(e.message) }
      }
      useEffect(() => { void load() }, [])
      return h('div', { style: css.panel },
        h('h3', { style: css.title }, '角色资产'),
        h('p', { style: css.note }, '网页端新建会话默认注入当前角色；切换只影响网页端，QQ 端人设仍由网关决定。'),
        err ? h('div', { style: css.warn }, err) : null,
        h('ul', { style: css.list }, items.map((it) => h('li', { key: it.key, style: css.item },
          h('span', null, `${it.key}（${it.chars} B）`),
          h('span', { style: css.actions },
            h('button', { style: css.btnGhost, onClick: () => preview(it.key) }, '预览'),
            h('button', { style: css.btn, onClick: () => select(it.key) }, it.key === active ? '当前' : '设为默认'))))),
        text ? h('pre', { style: css.pre }, text.slice(0, 4000)) : null)
    }
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dict), 'persona-hub: locale')
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 26,
          label: () => t('meta.title'), locale: NS,
        }, () => h('span', { title: String(t('meta.description')) }, '🎭'))), 'persona-hub: sidebar')
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID, locale: NS,
        }, Panel)), 'persona-hub: panel')
      },
    }
  },
})

const css = {
  panel: { padding: '16px', color: 'var(--dsw-alias-label-primary)', display: 'flex', flexDirection: 'column', gap: '8px' },
  title: { fontSize: '15px', margin: 0 },
  note: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: 1.5, margin: 0 },
  warn: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: '12px' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' },
  item: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', fontSize: '13px', borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: '6px' },
  actions: { display: 'flex', gap: '6px' },
  btn: { background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-label-on-color)', border: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' },
  btnGhost: { background: 'transparent', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' },
  pre: { whiteSpace: 'pre-wrap', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', padding: '10px', fontSize: '12px', maxHeight: '320px', overflow: 'auto' },
}
