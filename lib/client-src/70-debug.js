        tab === 'debug'
          ? h('div', { key: 'debug', style: css.tabPanel },
            // 5) 路由调试（含 reason/layer 中文诊断）
            h(Card, { title: t('res.title') },
              h('p', { style: css.hint }, t('res.hint')),
              h(Row, { style: { gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
                h(Field, { label: t('res.source') },
                  h(Select, {
                    value: resolveQ.source,
                    label: t('res.source'),
                    options: [
                      { value: 'dsh', label: t('res.sourceDsh') },
                      { value: 'bot', label: t('res.sourceBot') },
                    ],
                    onChange: (next) => setResolveQ((prev) => ({ ...prev, source: next })),
                  })),
                resolveQ.source === 'dsh' ? null : h(Field, { label: t('res.bot') },
                  h(Select, {
                    value: resolveQ.botId,
                    label: t('res.bot'),
                    options: [{ value: '', label: t('opt.unset') }].concat(
                      botIds.map((id) => ({ value: id, label: id }))),
                    onChange: (next) => setResolveQ((prev) => ({ ...prev, botId: next })),
                  })),
                resolveQ.source === 'dsh' ? null : h(Field, { label: t('res.chatType') },
                  h(Select, {
                    value: resolveQ.chatType,
                    label: t('res.chatType'),
                    options: [
                      { value: 'private', label: t('chan.private') },
                      { value: 'group', label: t('chan.group') },
                    ],
                    onChange: (next) => setResolveQ((prev) => ({ ...prev, chatType: next })),
                  })),
                resolveQ.source === 'dsh' ? null : h(Field, { label: t('res.target') },
                  h(TextInput, {
                    value: resolveQ.targetId,
                    placeholder: t('res.target'),
                    width: '150px',
                    mono: true,
                    onChange: (next) => setResolveQ((prev) => ({ ...prev, targetId: next })),
                  })),
                h(Btn, { tone: 'primary', onClick: () => { void runResolve() }, disabled: resolveBusy },
                  resolveBusy ? t('res.busy') : t('act.resolve'))),
              resolveErr ? h(Hint, { tone: 'error' }, resolveErr) : null,
              resolveRan
                ? (resolveOut
                  ? h('div', { style: css.resolveOut },
                    h('span', { style: css.resolveAvatar }, String(resolveOut.avatar || '🎭')),
                    h('span', { style: css.resolveName }, String(resolveOut.name || resolveOut.personaKey || '')),
                    h('code', { style: css.assetKey }, String(resolveOut.personaKey || '')))
                  : h('div', { style: css.resolveOut },
                    h(Hint, { tone: 'warn' }, t('res.noneReason', { reason: reasonText(t, resolveInfo.reason) })),
                    resolveInfo.layer
                      ? h('span', { style: css.metaLine }, `${t('res.layer')}: ${resolveInfo.layer}`)
                      : null))
                : null),

            // 6) 设置卡（assets.* + panel.*）
            h(SettingsCard, {
              t,
              cfg,
              assetsInfo,
              patchAssets,
              patchPanel,
            }))
          : null)

    }
