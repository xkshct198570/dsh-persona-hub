    // ---------------------------------------------------------------- 通道编辑器

    function ChannelEditor({ botId, which, channel, items, onPatch, t }) {
      const options = personaOptions(items, t, channel.defaultPersona)
      const [draft, setDraft] = useState({ target: '', persona: '' })
      const [addErr, setAddErr] = useState('')
      const targets = Object.keys(channel.bindings || {}).sort()
      const missingDefault = Boolean(channel.defaultPersona)
        && !items.some((it) => String(it.key || '') === channel.defaultPersona)

      function addBinding() {
        const target = draft.target.trim()
        if (!target) { setAddErr(t('chan.bindNeedTarget')); return }
        // 空绑定等于未设置，不值得写入配置：先要求选角色。
        if (!draft.persona) { setAddErr(t('chan.bindNeedPersona')); return }
        setAddErr('')
        onPatch(botId, which, (chan) => ({
          ...chan,
          bindings: { ...chan.bindings, [target]: draft.persona },
        }))
        setDraft({ target: '', persona: '' })
      }

      return h('div', { style: css.channel },
        h(Row, { style: { gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
          h(Field, { label: t('chan.enabled') },
            h(Switch, {
              checked: channel.enabled,
              label: `${t('chan.enabled')} · ${which}`,
              onChange: (next) => onPatch(botId, which, (chan) => ({ ...chan, enabled: next })),
            })),
          h(Field, { label: t('chan.default') },
            h(Row, { style: { gap: '6px', alignItems: 'center' } },
              h(Select, {
                value: channel.defaultPersona,
                options,
                label: t('chan.default'),
                onChange: (next) => onPatch(botId, which, (chan) => ({ ...chan, defaultPersona: next })),
              }),
              missingDefault ? h('span', { style: css.dangerTag }, t('assets.missingTag')) : null))),

        h('div', { style: css.subhead }, t('chan.bindings')),
        targets.length === 0
          ? h('p', { style: css.emptyLine }, t('chan.bindingsEmpty'))
          : h('div', { style: css.bindingList },
            targets.map((target) => h('div', { key: target, style: css.bindingRow },
              h('code', { style: css.targetId, title: target }, target),
              h(Select, {
                value: channel.bindings[target] || '',
                options: personaOptions(items, t, channel.bindings[target]),
                label: t('chan.bindPersona'),
                onChange: (next) => onPatch(botId, which, (chan) => {
                  const bindings = { ...chan.bindings }
                  if (!next) delete bindings[target]
                  else bindings[target] = next
                  return { ...chan, bindings }
                }),
              }),
              h(Btn, {
                tone: 'danger',
                title: t('act.remove'),
                onClick: () => onPatch(botId, which, (chan) => {
                  const bindings = { ...chan.bindings }
                  delete bindings[target]
                  return { ...chan, bindings }
                }),
              }, t('act.remove'))))),

        h(Row, { style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
          h(TextInput, {
            value: draft.target,
            placeholder: t('chan.bindTarget'),
            width: '180px',
            mono: true,
            onChange: (next) => setDraft((prev) => ({ ...prev, target: next })),
          }),
          h(Select, {
            value: draft.persona,
            options,
            label: t('chan.bindPersona'),
            onChange: (next) => setDraft((prev) => ({ ...prev, persona: next })),
          }),
          h(Btn, { onClick: addBinding }, t('chan.bindAdd'))),
        addErr ? h(Hint, { tone: 'warn' }, addErr) : null)
    }

    // ---------------------------------------------------------------- 主体卡片

    function BotCard({ botId, bot, items, onChange, onDelete, t }) {
      return h(Card, {
        title: h('span', { style: css.botTitle },
          h('code', { style: css.botId }, botId),
          h('span', { style: css.platformTag }, bot.platform || '—')),
        actions: h(Row, { style: { gap: '10px', alignItems: 'center' } },
          h(Field, { label: t('bots.enabled') },
            h(Switch, {
              checked: bot.enabled,
              label: t('bots.enabled'),
              onChange: (next) => onChange((prev) => ({ ...prev, enabled: next })),
            })),
          h(Btn, { tone: 'danger', onClick: onDelete, title: t('act.delete') }, t('act.delete'))),
      },
      h(Row, { style: { gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
        h(Field, { label: t('bots.platform') },
          h(TextInput, {
            value: bot.platform,
            width: '120px',
            placeholder: 'qq',
            onChange: (next) => onChange((prev) => ({ ...prev, platform: next })),
          }))),

      h('div', { style: css.channelBlock },
        h('h4', { style: css.channelTitle }, t('chan.private')),
        h(ChannelEditor, {
          botId, which: 'private', channel: bot.private, items, t,
          onPatch: (id, which, fn) => onChange((prev) => {
            const nextChannel = fn(prev[which])
            return { ...prev, [which]: nextChannel }
          }),
        })),

      h('div', { style: css.channelBlock },
        h('h4', { style: css.channelTitle }, t('chan.group')),
        h(ChannelEditor, {
          botId, which: 'group', channel: bot.group, items, t,
          onPatch: (id, which, fn) => onChange((prev) => {
            const nextChannel = fn(prev[which])
            return { ...prev, [which]: nextChannel }
          }),
        })))
    }

