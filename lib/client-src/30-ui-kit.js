    function Btn({ children, onClick, tone, disabled, title }) {
      const style = tone === 'primary'
        ? css.btnPrimary
        : tone === 'danger' ? css.btnDanger : css.btnGhost
      return h('button', {
        type: 'button', onClick, disabled: disabled || undefined, title,
        style: disabled ? { ...style, ...css.btnDisabled } : style,
      }, children)
    }

    function Switch({ checked, onChange, label, disabled }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        title: label,
        disabled: disabled || undefined,
        onClick: () => onChange(!checked),
        style: checked ? { ...css.switch, ...css.switchOn } : css.switch,
      }, h('span', { style: checked ? { ...css.thumb, ...css.thumbOn } : css.thumb }))
    }

    function Select({ value, options, onChange, label }) {
      return h('select', {
        value: value == null ? '' : value,
        'aria-label': label,
        title: label,
        onChange: (event) => onChange(event.target.value),
        style: css.select,
      }, options.map((opt) => h('option', { key: opt.value, value: opt.value }, opt.label)))
    }

    function TextInput({ value, onChange, placeholder, width, mono }) {
      return h('input', {
        type: 'text',
        value: value,
        placeholder,
        spellCheck: false,
        onChange: (event) => onChange(event.target.value),
        style: { ...css.input, ...(width ? { width } : null), ...(mono ? css.mono : null) },
      })
    }

    function Card({ title, actions, children }) {
      return h('section', { style: css.card },
        (title || actions)
          ? h('header', { style: css.cardHead },
            h('h3', { style: css.cardTitle }, title || ''),
            h('div', { style: css.cardActions }, actions || null))
          : null,
        children)
    }

    function Row({ children, style }) {
      return h('div', { style: { ...css.row, ...style } }, children)
    }

    function Hint({ children, tone }) {
      return h('p', { style: tone === 'warn' ? css.hintWarn : tone === 'error' ? css.hintError : css.hint },
        children)
    }

    function Field({ label, children }) {
      return h('label', { style: css.field },
        h('span', { style: css.fieldLabel }, label),
        children)
    }

