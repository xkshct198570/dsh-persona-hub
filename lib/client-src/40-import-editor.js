    // ---------------------------------------------------------------- 导入表单

    /**
     * 人设导入：FileReader/file.text() 读纯文本 → JSON POST /personas/import。
     * 成功只回报给父组件刷新列表，表单自身保持打开（便于连续导入）。
     */
    function ImportForm({ t, onImported, onCancel, onWriteFailed }) {
      const [draft, setDraft] = useState({ key: '', name: '', avatar: '', overwrite: false })
      const [text, setText] = useState('')
      const [fileName, setFileName] = useState('')
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState('')
      const [done, setDone] = useState('')

      function patchDraft(next) {
        setDraft((prev) => ({ ...prev, ...next }))
      }

      /** key 变更时，若显示名仍是空或仍跟随旧 key，就同步成新 key。 */
      function setKey(next) {
        setDraft((prev) => ({
          ...prev,
          key: next,
          name: !prev.name || prev.name === prev.key ? next : prev.name,
        }))
      }

      function readViaFileReader(file) {
        return new Promise((resolveText, rejectText) => {
          const reader = new FileReader()
          reader.onload = () => resolveText(String(reader.result || ''))
          reader.onerror = () => rejectText(reader.error || new Error('read_error'))
          reader.readAsText(file, 'utf-8')
        })
      }

      async function pickFile(event) {
        const input = event && event.target
        const file = input && input.files && input.files[0]
        if (!file) return
        setErr('')
        setDone('')
        if (Number(file.size) > MAX_FILE_BYTES) {
          setErr(t('imp.fileTooLarge', { size: formatBytes(file.size) }))
          return
        }
        try {
          const raw = typeof file.text === 'function'
            ? await file.text()
            : (typeof FileReader === 'function' ? await readViaFileReader(file) : '')
          const nextText = String(raw || '')
          setText(nextText)
          setFileName(String(file.name || ''))
          const derived = keyFromFileName(file.name)
          setDraft((prev) => ({
            ...prev,
            key: prev.key || derived,
            name: !prev.name || prev.name === prev.key ? (prev.key || derived) : prev.name,
          }))
        } catch (e) {
          setErr(t('imp.fileReadFailed', { message: (e && e.message) || String(e) }))
        }
      }

      async function submit() {
        if (busy) return
        setErr('')
        setDone('')
        const key = draft.key.trim()
        if (!KEY_RE.test(key)) { setErr(t('imp.keyInvalid')); return }
        if (!text.trim()) { setErr(t('imp.textEmpty')); return }
        if (text.length > MAX_TEXT_CHARS) {
          setErr(t('imp.tooLarge', { chars: String(text.length) }))
          return
        }
        setBusy(true)
        try {
          const res = await fetch(`${API}/personas/import`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              key,
              name: draft.name.trim() || key,
              avatar: draft.avatar.trim(),
              text,
              overwrite: draft.overwrite === true,
            }),
          })
          const body = await res.json().catch(() => null)
          if (!res.ok || !body || body.ok === false) {
            const code = String((body && body.error) || '')
            const detail = String((body && body.detail) || '')
            setErr(importErrorText(t, code, res.status, text.length, detail))
            // 只读目录：把状态回传给面板，禁用后续导入/删除并显示原因。
            if (code === 'write_failed' && typeof onWriteFailed === 'function') onWriteFailed(detail)
            return
          }
          const savedKey = String(body.key || key)
          const chars = Number(body.chars || text.length)
          setDone(t('imp.done', { key: savedKey, chars: String(chars) }))
          setText('')
          setFileName('')
          setDraft({ key: '', name: '', avatar: '', overwrite: false })
          onImported({ key: savedKey, chars })
        } catch (e) {
          setErr(t('imp.failed', { message: (e && e.message) || String(e) }))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: css.importBox },
        h('h4', { style: css.previewTitle }, t('imp.title')),
        h(Row, { style: { gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' } },
          h(Field, { label: t('imp.file') },
            h('input', {
              type: 'file',
              accept: '.txt,.md,text/plain',
              'aria-label': t('imp.file'),
              disabled: busy || undefined,
              onChange: (event) => { void pickFile(event) },
              style: css.fileInput,
            })),
          h('span', { style: css.metaLine },
            fileName
              ? `${fileName} · ${t('assets.chars', { chars: String(text.length) })}`
              : t('imp.fileHint'))),

        h(Row, { style: { gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' } },
          h(Field, { label: t('imp.key') },
            h(TextInput, {
              value: draft.key,
              placeholder: 'my-persona',
              width: '180px',
              mono: true,
              onChange: setKey,
            })),
          h(Field, { label: t('imp.name') },
            h(TextInput, {
              value: draft.name,
              placeholder: draft.key || t('imp.name'),
              width: '160px',
              onChange: (next) => patchDraft({ name: next }),
            })),
          h(Field, { label: t('imp.avatar') },
            h(TextInput, {
              value: draft.avatar,
              placeholder: '🎭',
              width: '96px',
              onChange: (next) => patchDraft({ avatar: next }),
            }))),

        h('label', { style: css.checkRow },
          h('input', {
            type: 'checkbox',
            checked: draft.overwrite === true,
            disabled: busy || undefined,
            onChange: (event) => patchDraft({ overwrite: event.target.checked === true }),
          }),
          h('span', { style: css.checkLabel }, t('imp.overwrite'))),

        err ? h(Hint, { tone: 'error' }, err) : null,
        done ? h('p', { style: css.okHint }, done) : null,

        h(Row, { style: { gap: '8px', alignItems: 'center' } },
          h(Btn, { tone: 'primary', disabled: busy, onClick: () => { void submit() } },
            busy ? t('imp.submitting') : t('imp.submit')),
          h(Btn, { disabled: busy, onClick: onCancel }, t('imp.cancel'))),

        h('p', { style: css.rulesLine }, t('imp.rules')))
    }

