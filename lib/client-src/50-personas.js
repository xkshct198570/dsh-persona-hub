        tab === 'personas'
          ? h('div', { key: 'personas', style: css.tabPanel },
            // 1) 资产卡片（导入 / 删除 / 预览）
            h(Card, {
              title: t('assets.title'),
              actions: h(Row, { style: { gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
                h('span', { style: css.countTag }, String(items.length)),
                h(Btn, {
                  disabled: readOnly,
                  title: readOnly ? readOnlyReason : t('assets.import'),
                  onClick: () => {
                    setShowImport((prev) => !prev)
                    setAssetErr('')
                    setAssetOk('')
                    setForceAsk(null)
                  },
                }, showImport ? t('act.close') : t('assets.import'))),
            },
            h(Row, { style: { gap: '14px', flexWrap: 'wrap' } },
              h('span', { style: css.metaLine },
                `${t('assets.dir')}: `,
                h('code', { style: css.mono }, effectiveDir)),
              h('span', { style: css.metaLine },
                `${t('assets.watch')}: ${assetsInfo.watch ? t('assets.on') : t('assets.off')}`)),

            readOnly
              ? h(Hint, { tone: 'error' }, t('assets.readonlyDir', { reason: readOnlyReason }))
              : null,

            showImport
              ? h(ImportForm, {
                t,
                onImported: () => { void onImported() },
                onCancel: () => setShowImport(false),
                onWriteFailed: markWriteFailed,
              })
              : null,

            assetErr ? h(Hint, { tone: 'error' }, assetErr) : null,
            assetOk ? h('p', { style: css.okHint }, assetOk) : null,

            items.length === 0
              ? h('p', { style: css.emptyLine }, t('assets.empty'))
              : h('ul', { style: css.assetList },
                items.map((it) => h('li', { key: it.key, style: css.assetItem },
                  h('button', {
                    type: 'button',
                    style: preview && preview.key === it.key ? { ...css.assetBtn, ...css.assetBtnActive } : css.assetBtn,
                    onClick: () => { void openPreview(it.key) },
                    title: t('act.preview'),
                  },
                  it.avatar ? h('span', { style: css.resolveAvatar }, String(it.avatar)) : null,
                  h('span', { style: css.assetName }, String(it.name || it.key)),
                  h('code', { style: css.assetKey }, String(it.key)),
                  it.origin === 'shipped' ? h('span', { style: css.shippedTag }, t('assets.shipped')) : null,
                  h('span', { style: css.assetChars }, t('assets.chars', { chars: String(it.chars || 0) }))),
                  it.key === cfg.dsh.defaultPersona
                    ? h('span', { style: css.currentTag }, t('dsh.default'))
                    : h(Btn, {
                      onClick: () => { void setDshDefault(it.key) },
                      disabled: saving,
                      title: t('act.setDefault'),
                    }, t('act.setDefault')),
                  it.deletable === true
                    ? h(Btn, {
                      tone: 'danger',
                      disabled: deleteBusy === it.key || readOnly,
                      title: readOnly ? readOnlyReason : t('assets.delete'),
                      onClick: () => { void askDelete(it.key) },
                    }, deleteBusy === it.key ? t('assets.deleting') : t('assets.delete'))
                    : null))),

            forceAsk
              ? h('div', { style: css.forceAsk },
                h('p', { style: css.hintWarn }, t('assets.delInUse', { key: forceAsk.key })),
                forceAsk.usage.length > 0
                  ? h('ul', { style: css.usageList }, forceAsk.usage.map((use, index) => h('li', {
                    key: `${index}:${String(use && use.where ? use.where : '')}`,
                    style: css.usageItem,
                  }, h('code', { style: css.mono }, String(use && use.where ? use.where : '?')))))
                  : null,
                h('p', { style: css.hint }, t('assets.delInUseAsk')),
                h(Row, { style: { gap: '8px', alignItems: 'center' } },
                  h(Btn, {
                    tone: 'danger',
                    disabled: deleteBusy === forceAsk.key || readOnly,
                    onClick: () => { void removeAsset(forceAsk.key, true) },
                  }, deleteBusy === forceAsk.key ? t('assets.deleting') : t('assets.forceDelete')),
                  h(Btn, { onClick: () => setForceAsk(null) }, t('assets.keep'))))
              : null),

            previewErr ? h(Hint, { tone: 'error' }, previewErr) : null,
            preview
              ? h('div', { style: css.previewBox },
                h(Row, { style: { gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
                  h('h4', { style: css.previewTitle }, t('assets.previewTitle', { key: preview.key })),
                  preview.name ? h('span', { style: css.assetName }, preview.name) : null,
                  h('span', { style: css.countTag }, t('assets.chars', { chars: String(preview.chars) })),
                  h('span', { style: css.metaLine }, t('assets.readonly')),
                  h(Btn, { onClick: () => setPreview(null) }, t('act.close'))),
                preview.description
                  ? h('p', { style: css.metaLine }, `${t('assets.description')}: ${preview.description}`)
                  : null,
                h('pre', { style: css.pre }, preview.text.slice(0, PREVIEW_LIMIT)),
                truncated
                  ? h('p', { style: css.metaLine },
                    t('assets.truncated', { shown: String(PREVIEW_LIMIT), total: String(preview.text.length) }))
                  : null)
              : h(Hint, null, t('assets.previewHint')),

            // 2) DSH 卡片
            h(Card, { title: t('dsh.title') },
              h(Row, { style: { gap: '12px', alignItems: 'center', flexWrap: 'wrap' } },
                h(Field, { label: t('dsh.enabled') },
                  h(Switch, {
                    checked: cfg.dsh.enabled,
                    label: t('dsh.enabled'),
                    onChange: (next) => patchDsh((dsh) => ({ ...dsh, enabled: next })),
                  })),
                h(Field, { label: t('dsh.default') },
                  h(Row, { style: { gap: '6px', alignItems: 'center' } },
                    h(Select, {
                      value: cfg.dsh.defaultPersona,
                      options: dshOptions,
                      label: t('dsh.default'),
                      onChange: (next) => patchDsh((dsh) => ({ ...dsh, defaultPersona: next })),
                    }),
                    dshMissing ? h('span', { style: css.dangerTag }, t('assets.missingTag')) : null))),
              h('p', { style: css.hint }, t('page.note'))))
          : null,

