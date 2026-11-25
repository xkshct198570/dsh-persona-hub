    // ---------------------------------------------------------------- 注册

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // 文案唯一真源：locale/*.json → scripts/i18n-check.mjs 生成的 dict。
        ctx.effect(() => ctx.locale.register(NS, dict), 'persona-hub: locale')
        // R9-07 第 5 条：细滚动条 <style> 只注入一次（按 id 判重，重挂/两插件先后装载都不叠加）。
        ctx.effect(() => { injectScrollbarStyle() }, 'persona-hub: scrollbar-style')
        const t = ctx.locale.bind(NS)

        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 26,
          label: () => t('page.title'),
          locale: NS,
        }, () => h('span', { title: String(t('page.note')) }, '🎭'))), 'persona-hub: sidebar entry')

        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ t }),
        }, Panel)), 'persona-hub: main panel')
      },
    }
  },
})
