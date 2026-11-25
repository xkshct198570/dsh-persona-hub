    // ---------------------------------------------------------------- 页签与设置

    function TabBar({ tab, onSelect, t }) {
      return h('div', { style: css.tabBar, role: 'tablist' },
        TABS.map(([id, labelKey]) => h('button', {
          key: id,
          type: 'button',
          role: 'tab',
          'aria-selected': tab === id ? 'true' : 'false',
          onClick: () => onSelect(id),
          style: tab === id ? { ...css.tab, ...css.tabActive } : css.tab,
        }, t(labelKey))))
    }

    function SettingRow({ t, label, desc, defaultText, effect, children }) {
      return h('div', { style: css.settingRow },
        h('div', { style: css.settingHead },
          h('span', { style: css.settingLabel }, label),
          h('span', { style: css.settingMeta }, `${t('settings.defaultLabel')}: ${defaultText}`),
          h('span', { style: css.settingMeta }, `${t('settings.effectLabel')}: ${effect}`)),
        children,
        desc ? h('p', { style: css.settingDesc }, desc) : null)
    }

