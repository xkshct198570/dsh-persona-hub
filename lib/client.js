/**
 * dsh-persona-hub Client 半：全平台多主体人设路由中枢（面板）。
 *
 * 只做展示与配置编辑；真正的路由解析在 Host 的 resolver / 网关上。
 * 页面结构：
 *   1) DSH 卡片     —— 网页端开关 + 默认角色 + 设为默认
 *   2) 主体卡片     —— 每个 bot 的开关/平台/私聊/群聊/绑定表/删除
 *   3) 添加主体     —— bot id + platform
 *   4) 角色资产     —— key/name/chars，点击预览正文（只读）
 *   5) 路由调试     —— 按契约 GET /resolve 验证分层兜底
 *   6) 统一保存     —— 一次 POST {dsh,bots} 全量，失败如实报错
 *
 * 规范：手写 React.createElement、零构建；只用 --dsw-alias-* 主题 token；
 * 不 import 宿主 Client 包；不写 document.body；不用 iframe。
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-hub',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    const NS = 'dsh-persona-hub'
    const PANEL_ID = 'persona-hub'
    const API = '/persona-hub/api'

    // ---------------------------------------------------------------- 文案

    const zh = {
      'page.title': '人设路由中枢',
      'page.note': '网页端与各平台主体共用一套角色资产；按「主体 → 会话类型 → 目标号」逐层回落，任一层关闭即兜底。',
      'page.dirty': '有未保存的修改',
      'page.saved': '已保存',
      'page.loading': '加载中…',
      'page.error': '加载失败：{message}',
      'page.emptyAssets': '资产目录里还没有角色文件（personas/prompts/<key>.txt）。',

      'act.refresh': '刷新',
      'act.save': '保存',
      'act.saving': '保存中…',
      'act.add': '添加',
      'act.remove': '移除',
      'act.preview': '预览',
      'act.close': '关闭',
      'act.delete': '删除主体',
      'act.setDefault': '设为 DSH 默认',
      'act.resolve': '解析',
      'act.retry': '重试',

      'dsh.title': '网页端（DSH）',
      'dsh.enabled': '启用网页端人设',
      'dsh.default': '默认角色',

      'bots.title': '主体',
      'bots.hint': '主体 id 不限于 QQ 号：任何平台的机器人/账号 id 都可以；platform 只作标注。',
      'bots.empty': '还没有主体。在下面添加一个 bot id。',
      'bots.id': '主体',
      'bots.platform': '平台',
      'bots.enabled': '启用主体',
      'bots.addId': '主体 ID',
      'bots.addPlatform': '平台',
      'bots.addAction': '添加主体',
      'bots.addMissing': '请先填写主体 ID。',
      'bots.addDup': '该主体已存在。',
      'bots.addTooLong': '主体 ID 太长了（上限 128 字符）。',
      'bots.delete': '删除',

      'chan.private': '私聊',
      'chan.group': '群聊',
      'chan.enabled': '启用通道',
      'chan.default': '默认角色',
      'chan.bindings': '特例绑定',
      'chan.bindingsEmpty': '暂无绑定，按默认角色处理。',
      'chan.bindTarget': '目标号',
      'chan.bindPersona': '绑定角色',
      'chan.bindAdd': '添加绑定',
      'chan.bindNeedTarget': '请先填写目标号。',

      'assets.title': '角色资产',
      'assets.empty': '资产为空。',
      'assets.chars': '{chars} 字',
      'assets.dir': '资产目录',
      'assets.watch': '监听变更',
      'assets.on': '开',
      'assets.off': '关',
      'assets.readonly': '只读预览',
      'assets.previewTitle': '预览：{key}',
      'assets.previewHint': '点击上面的角色查看正文；面板不改写资产文件。',
      'assets.unknownName': '未命名',

      'opt.none': '（不设置）',
      'opt.unset': '（未选择）',

      'res.title': '路由调试',
      'res.hint': '按当前配置解析一次，验证分层关闭/缺键是否落到兜底（null）。',
      'res.source': '来源',
      'res.sourceDsh': '网页端（dsh）',
      'res.sourceBot': '平台主体',
      'res.bot': '主体',
      'res.chatType': '会话类型',
      'res.target': '目标号',
      'res.result': '解析结果',
      'res.none': '无匹配人设（兜底 null）',
      'res.busy': '解析中…',
      'res.needBot': '请先选择主体。',

      'err.http': 'HTTP {status}',
      'err.saveFailed': '保存失败：{message}',
      'err.previewFailed': '预览失败：{message}',
      'err.resolveFailed': '解析失败：{message}',
    }

    const en = {
      'page.title': 'Persona Routing Hub',
      'page.note': 'The web client and every platform bot share one persona library; resolution falls back per bot → chat type → target, and any disabled layer yields the fallback.',
      'page.dirty': 'Unsaved changes',
      'page.saved': 'Saved',
      'page.loading': 'Loading…',
      'page.error': 'Failed to load: {message}',
      'page.emptyAssets': 'No persona files yet (personas/prompts/<key>.txt).',

      'act.refresh': 'Refresh',
      'act.save': 'Save',
      'act.saving': 'Saving…',
      'act.add': 'Add',
      'act.remove': 'Remove',
      'act.preview': 'Preview',
      'act.close': 'Close',
      'act.delete': 'Delete bot',
      'act.setDefault': 'Set as DSH default',
      'act.resolve': 'Resolve',
      'act.retry': 'Retry',

      'dsh.title': 'Web client (DSH)',
      'dsh.enabled': 'Enable web persona',
      'dsh.default': 'Default persona',

      'bots.title': 'Bots',
      'bots.hint': 'Bot ids are not limited to QQ numbers: any platform bot/account id works; platform is only a label.',
      'bots.empty': 'No bots yet. Add a bot id below.',
      'bots.id': 'Bot',
      'bots.platform': 'Platform',
      'bots.enabled': 'Enable bot',
      'bots.addId': 'Bot ID',
      'bots.addPlatform': 'Platform',
      'bots.addAction': 'Add bot',
      'bots.addMissing': 'Enter a bot ID first.',
      'bots.addDup': 'That bot already exists.',
      'bots.addTooLong': 'That bot ID is too long (128 characters max).',
      'bots.delete': 'Delete',

      'chan.private': 'Private chat',
      'chan.group': 'Group chat',
      'chan.enabled': 'Enable channel',
      'chan.default': 'Default persona',
      'chan.bindings': 'Per-target bindings',
      'chan.bindingsEmpty': 'No bindings; the default persona applies.',
      'chan.bindTarget': 'Target id',
      'chan.bindPersona': 'Persona',
      'chan.bindAdd': 'Add binding',
      'chan.bindNeedTarget': 'Enter a target id first.',

      'assets.title': 'Persona assets',
      'assets.empty': 'No assets.',
      'assets.chars': '{chars} chars',
      'assets.dir': 'Asset directory',
      'assets.watch': 'Watch changes',
      'assets.on': 'on',
      'assets.off': 'off',
      'assets.readonly': 'Read-only preview',
      'assets.previewTitle': 'Preview: {key}',
      'assets.previewHint': 'Click a persona above to read its text; the panel never writes asset files.',
      'assets.unknownName': 'unnamed',

      'opt.none': '(not set)',
      'opt.unset': '(not selected)',

      'res.title': 'Routing debug',
      'res.hint': 'Resolve once against the current config to verify that disabled layers and missing keys fall back to null.',
      'res.source': 'Source',
      'res.sourceDsh': 'Web client (dsh)',
      'res.sourceBot': 'Platform bot',
      'res.bot': 'Bot',
      'res.chatType': 'Chat type',
      'res.target': 'Target id',
      'res.result': 'Result',
      'res.none': 'No persona matched (fallback null)',
      'res.busy': 'Resolving…',
      'res.needBot': 'Pick a bot first.',

      'err.http': 'HTTP {status}',
      'err.saveFailed': 'Save failed: {message}',
      'err.previewFailed': 'Preview failed: {message}',
      'err.resolveFailed': 'Resolve failed: {message}',
    }

    // ---------------------------------------------------------------- 数据小件

    async function getJson(url) {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body || body.ok === false) {
        const e = new Error((body && body.error) || `HTTP ${res.status}`)
        e.status = res.status
        throw e
      }
      return body
    }

    async function postJson(url, payload) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body || body.ok === false) {
        const e = new Error((body && body.error) || `HTTP ${res.status}`)
        e.status = res.status
        throw e
      }
      return body
    }

    function emptyChannel() {
      return { enabled: true, defaultPersona: '', bindings: {} }
    }

    function normalizeChannel(raw) {
      const src = raw && typeof raw === 'object' ? raw : {}
      const bindings = {}
      const rawBindings = src.bindings && typeof src.bindings === 'object' ? src.bindings : {}
      for (const target of Object.keys(rawBindings)) {
        const value = rawBindings[target]
        if (typeof value === 'string') bindings[target] = value
      }
      return {
        enabled: src.enabled !== false,
        defaultPersona: typeof src.defaultPersona === 'string' ? src.defaultPersona : '',
        bindings,
      }
    }

    function normalizeBot(raw) {
      const src = raw && typeof raw === 'object' ? raw : {}
      return {
        enabled: src.enabled !== false,
        platform: typeof src.platform === 'string' && src.platform ? src.platform : 'qq',
        private: normalizeChannel(src.private),
        group: normalizeChannel(src.group),
      }
    }

    /** 把 Host 返回的 config 收敛成提交时可直接 POST 的完整形状。 */
    function normalizeConfig(raw) {
      const src = raw && typeof raw === 'object' ? raw : {}
      const dshRaw = src.dsh && typeof src.dsh === 'object' ? src.dsh : {}
      const bots = {}
      const rawBots = src.bots && typeof src.bots === 'object' ? src.bots : {}
      for (const botId of Object.keys(rawBots)) bots[botId] = normalizeBot(rawBots[botId])
      return {
        dsh: {
          enabled: dshRaw.enabled !== false,
          defaultPersona: typeof dshRaw.defaultPersona === 'string' ? dshRaw.defaultPersona : '',
        },
        bots,
      }
    }

    function personaOptions(items, t, selected) {
      const list = [{ value: '', label: t('opt.none') }]
      const seen = new Set([''])
      for (const it of items) {
        const key = String(it.key || '')
        if (!key || seen.has(key)) continue
        seen.add(key)
        list.push({ value: key, label: `${it.name || key}（${key}）` })
      }
      // 配置里指向了资产中不存在的 key：照实显示，便于发现坏配置。
      if (selected && !seen.has(selected)) {
        list.push({ value: selected, label: `${selected}（${t('assets.unknownName')}）` })
      }
      return list
    }

    // ---------------------------------------------------------------- 基础控件

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

    // ---------------------------------------------------------------- 通道编辑器

    function ChannelEditor({ botId, which, channel, items, onPatch, t }) {
      const options = personaOptions(items, t, channel.defaultPersona)
      const [draft, setDraft] = useState({ target: '', persona: '' })
      const [addErr, setAddErr] = useState('')
      const targets = Object.keys(channel.bindings || {}).sort()

      function addBinding() {
        const target = draft.target.trim()
        if (!target) { setAddErr(t('chan.bindNeedTarget')); return }
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
            h(Select, {
              value: channel.defaultPersona,
              options,
              label: t('chan.default'),
              onChange: (next) => onPatch(botId, which, (chan) => ({ ...chan, defaultPersona: next })),
            }))),

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

    // ---------------------------------------------------------------- 主面板

    function Panel({ t }) {
      const [status, setStatus] = useState('loading')
      const [loadErr, setLoadErr] = useState('')
      const [items, setItems] = useState([])
      const [cfg, setCfg] = useState(null)
      const [baseline, setBaseline] = useState('')
      const [assetsInfo, setAssetsInfo] = useState({ dir: '', watch: false })
      const [saving, setSaving] = useState(false)
      const [saveErr, setSaveErr] = useState('')
      const [savedSeq, setSavedSeq] = useState(0)
      const [preview, setPreview] = useState(null)
      const [previewErr, setPreviewErr] = useState('')
      const [newBot, setNewBot] = useState({ id: '', platform: 'qq' })
      const [addErr, setAddErr] = useState('')
      const [resolveQ, setResolveQ] = useState({ source: 'dsh', botId: '', chatType: 'private', targetId: '' })
      const [resolveOut, setResolveOut] = useState(null)
      const [resolveRan, setResolveRan] = useState(false)
      const [resolveErr, setResolveErr] = useState('')
      const [resolveBusy, setResolveBusy] = useState(false)

      const load = useCallback(async () => {
        setStatus('loading')
        setLoadErr('')
        try {
          const [personaRes, configRes] = await Promise.all([
            getJson(`${API}/personas`),
            getJson(`${API}/config`),
          ])
          setItems(Array.isArray(personaRes.items) ? personaRes.items : [])
          const norm = normalizeConfig(configRes.config)
          setCfg(norm)
          setBaseline(JSON.stringify(norm))
          const assets = (configRes.config && configRes.config.assets) || {}
          setAssetsInfo({ dir: String(assets.dir || ''), watch: assets.watch === true })
          setStatus('ready')
        } catch (e) {
          setLoadErr(e.message || String(e))
          setStatus('error')
        }
      }, [])

      useEffect(() => { void load() }, [load])

      const dirty = Boolean(cfg) && JSON.stringify(cfg) !== baseline

      const save = useCallback(async (target) => {
        if (!target) return false
        setSaving(true)
        setSaveErr('')
        try {
          await postJson(`${API}/config`, { config: { dsh: target.dsh, bots: target.bots } })
          // 以服务端为准回读，避免把本地草稿当成功。
          const configRes = await getJson(`${API}/config`)
          const norm = normalizeConfig(configRes.config)
          setCfg(norm)
          setBaseline(JSON.stringify(norm))
          setSavedSeq((seq) => seq + 1)
          return true
        } catch (e) {
          setSaveErr(e.message || String(e))
          return false
        } finally {
          setSaving(false)
        }
      }, [])

      function patchDsh(fn) {
        setCfg((prev) => (prev ? { ...prev, dsh: fn(prev.dsh) } : prev))
      }

      function patchBot(botId, updater) {
        setCfg((prev) => {
          if (!prev) return prev
          const bot = prev.bots[botId]
          if (!bot) return prev
          const nextBot = updater(bot)
          if (!nextBot) return prev
          return { ...prev, bots: { ...prev.bots, [botId]: nextBot } }
        })
      }

      function deleteBot(botId) {
        setCfg((prev) => {
          if (!prev) return prev
          const bots = { ...prev.bots }
          delete bots[botId]
          return { ...prev, bots }
        })
      }

      function addBot() {
        const id = newBot.id.trim()
        if (!id) { setAddErr(t('bots.addMissing')); return }
        if (id.length > 128) { setAddErr(t('bots.addTooLong')); return }
        if (cfg && cfg.bots[id]) { setAddErr(t('bots.addDup')); return }
        setAddErr('')
        const platform = newBot.platform.trim() || 'qq'
        setCfg((prev) => (prev
          ? { ...prev, bots: { ...prev.bots, [id]: normalizeBot({ enabled: true, platform, private: emptyChannel(), group: emptyChannel() }) } }
          : prev))
        setNewBot({ id: '', platform: 'qq' })
      }

      async function setDshDefault(key) {
        const nextDsh = { ...(cfg.dsh || { enabled: true, defaultPersona: '' }), defaultPersona: key }
        const next = { dsh: nextDsh, bots: cfg.bots }
        setCfg(next)
        await save(next)
      }

      async function openPreview(key) {
        setPreviewErr('')
        try {
          const body = await getJson(`${API}/persona?key=${encodeURIComponent(key)}`)
          setPreview({
            key: body.key || key,
            name: String((body.meta && body.meta.name) || ''),
            text: String(body.text || ''),
            chars: Number(body.chars || 0) || String(body.text || '').length,
            mtime: Number(body.mtime || 0),
          })
        } catch (e) {
          setPreview(null)
          setPreviewErr(t('err.previewFailed', { message: e.message || String(e) }))
        }
      }

      async function runResolve() {
        const bot = resolveQ.botId ? cfg.bots[resolveQ.botId] : null
        if (resolveQ.source !== 'dsh' && !bot) { setResolveErr(t('res.needBot')); return }
        // 契约：source 对主体来源取平台名（如 qq），bot_id 才是主体 id。
        const query = resolveQ.source === 'dsh'
          ? 'source=dsh'
          : `source=${encodeURIComponent((bot && bot.platform) || 'qq')}`
            + `&bot_id=${encodeURIComponent(resolveQ.botId)}`
            + `&chat_type=${encodeURIComponent(resolveQ.chatType || '')}`
            + `&target_id=${encodeURIComponent(resolveQ.targetId || '')}`
        setResolveBusy(true)
        setResolveErr('')
        try {
          const body = await getJson(`${API}/resolve?${query}`)
          setResolveOut(body.persona || null)
          setResolveRan(true)
        } catch (e) {
          setResolveOut(null)
          setResolveRan(false)
          setResolveErr(t('err.resolveFailed', { message: e.message || String(e) }))
        } finally {
          setResolveBusy(false)
        }
      }

      if (status === 'loading') {
        return h('div', { style: css.page },
          h('h2', { style: css.pageTitle }, t('page.title')),
          h(Hint, null, t('page.loading')))
      }

      if (status === 'error') {
        return h('div', { style: css.page },
          h('h2', { style: css.pageTitle }, t('page.title')),
          h(Hint, { tone: 'error' }, t('page.error', { message: loadErr })),
          h(Row, null, h(Btn, { onClick: () => { void load() } }, t('act.retry'))))
      }

      if (!cfg) {
        return h('div', { style: css.page },
          h('h2', { style: css.pageTitle }, t('page.title')),
          h(Hint, { tone: 'error' }, t('page.error', { message: 'no_config' })),
          h(Row, null, h(Btn, { onClick: () => { void load() } }, t('act.retry'))))
      }

      const botIds = Object.keys(cfg.bots).sort()
      const dshOptions = personaOptions(items, t, cfg.dsh.defaultPersona)

      return h('div', { style: css.page },
        h('header', { style: css.pageHead },
          h('div', null,
            h('h2', { style: css.pageTitle }, t('page.title')),
            h('p', { style: css.pageNote }, t('page.note'))),
          h(Row, { style: { gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
            dirty ? h('span', { style: css.dirtyTag }, t('page.dirty')) : null,
            savedSeq > 0 && !dirty ? h('span', { style: css.okTag }, t('page.saved')) : null,
            h(Btn, { onClick: () => { void load() }, disabled: saving }, t('act.refresh')),
            h(Btn, {
              tone: 'primary',
              disabled: saving || !dirty,
              onClick: () => { void save(cfg) },
            }, saving ? t('act.saving') : t('act.save')))),

        saveErr ? h(Hint, { tone: 'error' }, t('err.saveFailed', { message: saveErr })) : null,

        // 1) DSH 卡片
        h(Card, { title: t('dsh.title') },
          h(Row, { style: { gap: '12px', alignItems: 'center', flexWrap: 'wrap' } },
            h(Field, { label: t('dsh.enabled') },
              h(Switch, {
                checked: cfg.dsh.enabled,
                label: t('dsh.enabled'),
                onChange: (next) => patchDsh((dsh) => ({ ...dsh, enabled: next })),
              })),
            h(Field, { label: t('dsh.default') },
              h(Select, {
                value: cfg.dsh.defaultPersona,
                options: dshOptions,
                label: t('dsh.default'),
                onChange: (next) => patchDsh((dsh) => ({ ...dsh, defaultPersona: next })),
              }))),
          h('p', { style: css.hint }, t('page.note'))),

        // 2) 主体列表
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

        // 3) 添加主体
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
          addErr ? h(Hint, { tone: 'warn' }, addErr) : null),

        // 4) 资产卡片
        h(Card, {
          title: t('assets.title'),
          actions: h('span', { style: css.countTag }, String(items.length)),
        },
        h(Row, { style: { gap: '14px', flexWrap: 'wrap' } },
          h('span', { style: css.metaLine },
            `${t('assets.dir')}: `,
            h('code', { style: css.mono }, assetsInfo.dir || '—')),
          h('span', { style: css.metaLine },
            `${t('assets.watch')}: ${assetsInfo.watch ? t('assets.on') : t('assets.off')}`)),
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
              h('span', { style: css.assetChars }, t('assets.chars', { chars: String(it.chars || 0) }))),
              it.key === cfg.dsh.defaultPersona
                ? h('span', { style: css.currentTag }, t('dsh.default'))
                : h(Btn, {
                  onClick: () => { void setDshDefault(it.key) },
                  disabled: saving,
                  title: t('act.setDefault'),
                }, t('act.setDefault')))))),

        previewErr ? h(Hint, { tone: 'error' }, previewErr) : null,
        preview
          ? h('div', { style: css.previewBox },
            h(Row, { style: { gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
              h('h4', { style: css.previewTitle }, t('assets.previewTitle', { key: preview.key })),
              preview.name ? h('span', { style: css.assetName }, preview.name) : null,
              h('span', { style: css.countTag }, t('assets.chars', { chars: String(preview.chars) })),
              h('span', { style: css.metaLine }, t('assets.readonly')),
              h(Btn, { onClick: () => setPreview(null) }, t('act.close'))),
            h('pre', { style: css.pre }, preview.text.slice(0, 20000)))
          : h(Hint, null, t('assets.previewHint')),

        // 5) 路由调试
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
              : h(Hint, { tone: 'warn' }, t('res.none')))
            : null))
    }

    // ---------------------------------------------------------------- 样式

    const css = {
      page: {
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)',
        boxSizing: 'border-box',
        minHeight: '100%',
      },
      pageHead: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: '12px',
        flexWrap: 'wrap',
      },
      pageTitle: { fontSize: '18px', fontWeight: 600, margin: 0 },
      pageNote: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '12px',
        lineHeight: 1.6,
        margin: '4px 0 0',
        maxWidth: '700px',
      },
      card: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '10px',
        background: 'var(--dsw-alias-card-fill)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      },
      cardHead: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '10px',
        flexWrap: 'wrap',
      },
      cardTitle: { fontSize: '14px', fontWeight: 600, margin: 0 },
      cardActions: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      sectionHead: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' },
      countTag: {
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '999px',
        padding: '1px 8px',
      },
      dirtyTag: {
        fontSize: '11px',
        color: 'var(--dsw-alias-state-warn-label)',
        background: 'var(--dsw-alias-state-warn-tertiary)',
        borderRadius: '999px',
        padding: '1px 8px',
      },
      okTag: {
        fontSize: '11px',
        color: 'var(--dsw-alias-state-success-primary)',
        background: 'var(--dsw-alias-state-success-tertiary)',
        borderRadius: '999px',
        padding: '1px 8px',
      },
      row: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
      field: { display: 'flex', flexDirection: 'column', gap: '4px' },
      fieldLabel: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      hint: {
        fontSize: '12px',
        lineHeight: 1.6,
        margin: 0,
        color: 'var(--dsw-alias-label-secondary)',
      },
      hintWarn: {
        fontSize: '12px',
        lineHeight: 1.6,
        margin: 0,
        color: 'var(--dsw-alias-state-warn-primary)',
      },
      hintError: {
        fontSize: '12px',
        lineHeight: 1.6,
        margin: 0,
        color: 'var(--dsw-alias-state-error-primary)',
      },
      emptyLine: {
        fontSize: '12px',
        margin: 0,
        color: 'var(--dsw-alias-label-tertiary)',
      },
      metaLine: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },

      btnPrimary: {
        background: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-label-on-color)',
        border: '1px solid var(--dsw-alias-brand-primary)',
        borderRadius: '6px',
        padding: '4px 12px',
        fontSize: '12px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      btnGhost: {
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '6px',
        padding: '4px 12px',
        fontSize: '12px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      btnDanger: {
        background: 'transparent',
        color: 'var(--dsw-alias-state-error-primary)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '6px',
        padding: '4px 12px',
        fontSize: '12px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      btnDisabled: {
        opacity: 0.45,
        cursor: 'not-allowed',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        borderColor: 'var(--dsw-alias-border-l1)',
      },

      switch: {
        position: 'relative',
        width: '36px',
        height: '20px',
        borderRadius: '999px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        padding: 0,
        cursor: 'pointer',
        flex: 'none',
      },
      switchOn: {
        background: 'var(--dsw-alias-brand-primary)',
        borderColor: 'var(--dsw-alias-brand-primary)',
      },
      thumb: {
        position: 'absolute',
        top: '2px',
        left: '2px',
        width: '14px',
        height: '14px',
        borderRadius: '999px',
        background: 'var(--dsw-alias-switch-thumb)',
        transition: 'transform 120ms ease',
      },
      thumbOn: { transform: 'translateX(16px)' },

      select: {
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '6px',
        padding: '4px 8px',
        fontSize: '12px',
        minWidth: '140px',
      },
      input: {
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '6px',
        padding: '4px 8px',
        fontSize: '12px',
      },

      botTitle: { display: 'inline-flex', gap: '8px', alignItems: 'center' },
      botId: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '13px',
      },
      platformTag: {
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '999px',
        padding: '1px 8px',
      },
      channelBlock: {
        borderTop: '1px solid var(--dsw-alias-border-l1)',
        paddingTop: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      },
      channelTitle: { fontSize: '12px', fontWeight: 600, margin: 0, color: 'var(--dsw-alias-label-primary)' },
      subhead: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      channel: { display: 'flex', flexDirection: 'column', gap: '8px' },
      bindingList: { display: 'flex', flexDirection: 'column', gap: '6px' },
      bindingRow: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      targetId: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        borderRadius: '4px',
        padding: '2px 6px',
        minWidth: '90px',
      },

      assetList: {
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      },
      assetItem: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      assetBtn: {
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        flex: '1 1 320px',
        minWidth: '240px',
        background: 'transparent',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        padding: '6px 10px',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        textAlign: 'left',
      },
      assetBtnActive: {
        borderColor: 'var(--dsw-alias-border-selected)',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      assetName: { fontSize: '12px', fontWeight: 600 },
      assetKey: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      assetChars: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginLeft: 'auto' },
      currentTag: {
        fontSize: '11px',
        color: 'var(--dsw-alias-brand-text)',
        border: '1px solid var(--dsw-alias-brand-primary)',
        borderRadius: '999px',
        padding: '1px 8px',
        whiteSpace: 'nowrap',
      },
      previewBox: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-1)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      },
      previewTitle: { fontSize: '13px', fontWeight: 600, margin: 0 },
      pre: {
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        padding: '10px',
        fontSize: '12px',
        lineHeight: 1.6,
        maxHeight: '360px',
        overflow: 'auto',
        margin: 0,
        color: 'var(--dsw-alias-label-primary)',
      },
      resolveOut: {
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        padding: '8px 12px',
        flexWrap: 'wrap',
      },
      resolveAvatar: { fontSize: '16px' },
      resolveName: { fontSize: '13px', fontWeight: 600 },
    }

    // ---------------------------------------------------------------- 注册

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'persona-hub: locale')
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
