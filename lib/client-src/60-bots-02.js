        tab === 'bots'
          ? h('div', { key: 'bots', style: css.tabPanel },
            h('div', { style: css.sectionHead },
              h('h3', { style: css.cardTitle }, t('bots.title')),
              h('span', { style: css.countTag }, String(botIds.length))),
            h('p', { style: css.hint }, t('bots.hint')),

            botIds.length === 0
              ? h(Card, null, h('p', { style: css.emptyLine }, t('bots.empty')))
              : botIds.map((botId) => h(BotCard, {
                key: botId,
                botId,
                bot: cfg.bots[botId],
                items,
                t,
                onChange: (updater) => patchBot(botId, updater),
                onDelete: () => deleteBot(botId),
              })),

            h(Card, { title: t('bots.addAction') },
              h(Row, { style: { gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
                h(Field, { label: t('bots.addId') },
                  h(TextInput, {
                    value: newBot.id,
                    placeholder: '123456789',
                    width: '180px',
                    mono: true,
                    onChange: (next) => setNewBot((prev) => ({ ...prev, id: next })),
                  })),
                h(Field, { label: t('bots.addPlatform') },
                  h(TextInput, {
                    value: newBot.platform,
                    placeholder: 'qq',
                    width: '110px',
                    onChange: (next) => setNewBot((prev) => ({ ...prev, platform: next })),
                  })),
                h(Btn, { tone: 'primary', onClick: addBot }, t('bots.addAction'))),
              addErr ? h(Hint, { tone: 'warn' }, addErr) : null))
          : null,

