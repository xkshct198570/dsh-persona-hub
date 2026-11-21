/**
 * dsh-persona-hub Client 半（S1 骨架）：左栏图标 + 空面板；角色编辑器在 S3 落地。
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-hub',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-persona-hub'
    const PANEL_ID = 'persona-hub'
    const dict = {
      zh: { meta: { title: '双人设与角色', description: '人设文本、角色切换与按角色对话' },
            panel: { skeleton: 'S1 骨架：角色编辑器在 S3 落地' } },
      en: { meta: { title: 'Persona Hub', description: 'Persona texts, role switching and chat' },
            panel: { skeleton: 'S1 skeleton: editor lands in S3' } },
    }
    function Panel(props) {
      return h('div', { style: { padding: '16px', color: 'var(--dsw-alias-label-primary)' } },
        String(props.t('panel.skeleton')))
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
        }, (props) => h(Panel, { ...props, t }))), 'persona-hub: panel')
      },
    }
  },
})
