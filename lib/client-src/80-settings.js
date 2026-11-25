    /**
     * 设置卡承载 §18.6 的 5 个非 bot 字段：assets.dir/watch（重挂）与 panel.*（即时）。
     * 每行按 §7.3 显示「名称 + 场景句 + 默认 + 生效」。
     */
    function SettingsCard({ t, cfg, assetsInfo, patchAssets, patchPanel }) {
      return h(Card, { title: t('settings.title') },
        h('div', { style: css.settingGroupTitle }, t('settings.groupAssets')),

        h(SettingRow, {
          t,
          label: t('assets.dir'),
          desc: t('settings.dirDesc'),
          defaultText: assetsInfo.effectiveDir || '$DSH_HOME/persona-hub/prompts',
          effect: t('settings.effectReload'),
        },
        h(TextInput, {
          value: cfg.assets.dir,
          placeholder: assetsInfo.effectiveDir || t('settings.dirDefault'),
          width: '100%',
          mono: true,
          onChange: (next) => patchAssets((assets) => ({ ...assets, dir: next })),
        })),

        h(SettingRow, {
          t,
          label: t('assets.watch'),
          desc: t('settings.watchDesc'),
          defaultText: t('assets.on'),
          effect: t('settings.effectReload'),
        },
        h(Switch, {
          checked: cfg.assets.watch !== false,
          label: t('assets.watch'),
          onChange: (next) => patchAssets((assets) => ({ ...assets, watch: next })),
        })),

        h('div', { style: css.settingGroupTitle }, t('settings.groupPanel')),

        h(SettingRow, {
          t,
          label: t('settings.allowRemote'),
          desc: t('settings.allowRemoteDesc'),
          defaultText: t('assets.off'),
          effect: t('settings.effectInstant'),
        },
        h(Switch, {
          checked: cfg.panel.allowRemote === true,
          label: t('settings.allowRemote'),
          onChange: (next) => patchPanel((panel) => ({ ...panel, allowRemote: next })),
        })),

        h(SettingRow, {
          t,
          label: t('settings.pollMs'),
          desc: t('settings.pollMsDesc'),
          defaultText: '60000',
          effect: t('settings.effectInstant'),
        },
        h('input', {
          type: 'number',
          min: 5000,
          max: 600000,
          step: 1000,
          value: String(cfg.panel.pollMs),
          'aria-label': t('settings.pollMsDesc'),
          onChange: (event) => {
            const next = Number(event.target.value)
            patchPanel((panel) => ({ ...panel, pollMs: Number.isFinite(next) ? Math.floor(next) : 0 }))
          },
          style: css.input,
        })),

        h(SettingRow, {
          t,
          label: t('settings.tab'),
          desc: t('settings.tabDesc'),
          defaultText: t('page.tabPersonas'),
          effect: t('settings.effectInstant'),
        },
        h(Select, {
          value: cfg.panel.tab,
          label: t('settings.tab'),
          options: TABS.map(([id, labelKey]) => ({ value: id, label: t(labelKey) })),
          onChange: (next) => patchPanel((panel) => ({ ...panel, tab: next })),
        })))
    }

