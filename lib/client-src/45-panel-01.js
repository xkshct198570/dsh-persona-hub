    // ---------------------------------------------------------------- 主面板

    // ---------------------------------------------------- scroll contract（R9-07）

    /** 细滚动条样式的唯一 id：与鲸忆共用同一 id，后装载的一方按 id 判重不再插入。 */
    const SCROLLBAR_STYLE_ID = 'dsh-scroll-contract'

    /**
     * 注入细滚动条宽度（R9-07 第 5 条）。
     * Why 按 id 判重：面板重挂/重复装载不能让 <style> 无限增长；无 document 时静默跳过。
     */
    function injectScrollbarStyle() {
      if (typeof document === 'undefined' || !document || !document.head) return
      if (typeof document.getElementById === 'function' && document.getElementById(SCROLLBAR_STYLE_ID)) return
      const style = document.createElement('style')
      style.id = SCROLLBAR_STYLE_ID
      style.textContent = '::-webkit-scrollbar{width:8px}'
      document.head.appendChild(style)
    }

    /**
     * 页根键盘滚动（R9-07 第 6 条）：PageUp/PageDown 翻一屏，Home/End 到顶/底。
     * Why 自己算：页根是普通 div，浏览器不原生响应这些键；不写自定义 wheel/transform 滚动。
     * 输入控件里的 Home/End 属于光标语义，不接管。
     */
    function onScrollRegionKeys(event) {
      const node = event && event.currentTarget
      if (!node || typeof node.scrollTop !== 'number') return
      const target = event.target || null
      const tag = String((target && target.tagName) || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable)) return
      const screen = Math.max(1, Math.round((node.clientHeight || 0) * 0.9))
      if (event.key === 'PageDown') { node.scrollTop += screen; event.preventDefault() }
      else if (event.key === 'PageUp') { node.scrollTop -= screen; event.preventDefault() }
      else if (event.key === 'Home') { node.scrollTop = 0; event.preventDefault() }
      else if (event.key === 'End') { node.scrollTop = node.scrollHeight; event.preventDefault() }
    }

    /**
     * 页根滚动契约属性（R9-07 第 1/6 条）：`data-wm-scroll` 标记唯一纵向滚动根，
     * 键盘可聚焦 + region 语义；aria-label 复用页面标题，不新增文案键。
     */
    function scrollRegionProps(t) {
      return {
        tabIndex: 0,
        role: 'region',
        'aria-label': t('page.title'),
        'data-wm-scroll': 'page',
        onKeyDown: (event) => onScrollRegionKeys(event),
      }
    }

    function Panel({ t }) {
      const [status, setStatus] = useState('loading')
      const [loadErr, setLoadErr] = useState('')
      const [items, setItems] = useState([])
      const [cfg, setCfg] = useState(null)
      const [baseline, setBaseline] = useState('')
      const [assetsInfo, setAssetsInfo] = useState({
        dir: '', effectiveDir: '', watch: false, writable: true, writeReason: '',
      })
      const [tab, setTab] = useState('personas')
      const [saving, setSaving] = useState(false)
      const [saveErr, setSaveErr] = useState('')
      const [statusMsg, setStatusMsg] = useState('')
      const [savedSeq, setSavedSeq] = useState(0)
      const [preview, setPreview] = useState(null)
      const [previewErr, setPreviewErr] = useState('')
      const [newBot, setNewBot] = useState({ id: '', platform: 'qq' })
      const [addErr, setAddErr] = useState('')
      const [resolveQ, setResolveQ] = useState({ source: 'dsh', botId: '', chatType: 'private', targetId: '' })
      const [resolveOut, setResolveOut] = useState(null)
      const [resolveInfo, setResolveInfo] = useState({ reason: '', layer: '' })
      const [resolveRan, setResolveRan] = useState(false)
      const [resolveErr, setResolveErr] = useState('')
      const [resolveBusy, setResolveBusy] = useState(false)
      const [showImport, setShowImport] = useState(false)
      const [assetErr, setAssetErr] = useState('')
      const [assetOk, setAssetOk] = useState('')
      const [deleteBusy, setDeleteBusy] = useState('')
      const [forceAsk, setForceAsk] = useState(null) // {key, usage:[{where}]}
      const [reloading, setReloading] = useState(false)
      const [writeFailed, setWriteFailed] = useState(false)
      const [pollMs, setPollMs] = useState(60000)
      const tabInit = useRef(false)
      const dirtyRef = useRef(false)

      /** 服务端 config → 草稿/baseline/资产状态/轮询间隔/初始页签。 */
      const applyServerConfig = useCallback((raw) => {
        const norm = normalizeConfig(raw)
        setCfg(norm)
        setBaseline(JSON.stringify(norm))
        const assets = raw && typeof raw.assets === 'object' && raw.assets ? raw.assets : {}
        setAssetsInfo({
          dir: String(assets.dir || ''),
          effectiveDir: String(assets.effectiveDir || norm.assets.dir || ''),
          watch: norm.assets.watch,
          writable: assets.writable !== false,
          writeReason: String(assets.writeReason || ''),
        })
        setPollMs(norm.panel.pollMs)
        // panel.tab 是初始页签，只在首屏生效；轮询/保存回读不得把用户拉回别的页签。
        if (!tabInit.current) {
          tabInit.current = true
          setTab(norm.panel.tab)
        }
        return norm
      }, [])

      const load = useCallback(async (initial) => {
        if (initial !== false) setStatus('loading')
        setLoadErr('')
        try {
          const [personaRes, configRes] = await Promise.all([
            getJson(`${API}/personas`),
            getJson(`${API}/config`),
          ])
          setItems(Array.isArray(personaRes.items) ? personaRes.items : [])
          applyServerConfig(configRes.config)
          setStatus('ready')
        } catch (e) {
          setLoadErr(e.message || String(e))
          setStatus('error')
        }
      }, [applyServerConfig])

      useEffect(() => { void load(true) }, [load])

      const dirty = Boolean(cfg) && JSON.stringify(cfg) !== baseline
      useEffect(() => { dirtyRef.current = dirty }, [dirty])

      /** 轮询：只在没有未保存草稿时静默回读，避免覆盖用户正在编辑的字段。 */
      const poll = useCallback(async () => {
        if (dirtyRef.current) return
        try {
          const [personaRes, configRes] = await Promise.all([
            getJson(`${API}/personas`),
            getJson(`${API}/config`),
          ])
          setItems(Array.isArray(personaRes.items) ? personaRes.items : [])
          applyServerConfig(configRes.config)
        } catch { /* 轮询失败静默：保留上一份快照，不打断编辑 */ }
      }, [applyServerConfig])

      useEffect(() => {
        if (status !== 'ready' || !pollMs) return undefined
        const timer = setInterval(() => { void poll() }, pollMs)
        return () => clearInterval(timer)
      }, [status, pollMs, poll])

      const save = useCallback(async (target) => {
        if (!target) return false
        const invalid = validateConfig(t, target)
        if (invalid) {
          setSaveErr(t('err.invalidConfig', { message: invalid }))
          return false
        }
        setSaving(true)
        setSaveErr('')
        setStatusMsg('')
        try {
          const before = baseline ? JSON.parse(baseline) : null
          const body = await postJson(`${API}/config`, {
            config: { dsh: target.dsh, bots: target.bots, assets: target.assets, panel: target.panel },
          })
          // 以服务端为准回读，避免把本地草稿当成功。
          const configRes = await getJson(`${API}/config`)
          applyServerConfig(configRes.config)
          setSavedSeq((seq) => seq + 1)
          if (body.readBackFailed === true) {
            // 已落盘但回读不一致：不得复用「保存失败」文案，否则用户会以为没保存。
            setStatusMsg(t('page.savedReadBackFailed'))
          } else if (!before || JSON.stringify(before.assets) !== JSON.stringify(target.assets)) {
            setStatusMsg(t('page.reloadNeeded'))
          } else if (body.mirrorSynced === false) {
            setStatusMsg(t('err.mirrorFailed'))
          }
          return true
        } catch (e) {
          setSaveErr(t('err.saveFailed', { message: errorText(t, e.message, e.detail) }))
          return false
        } finally {
          setSaving(false)
        }
      }, [applyServerConfig, baseline, t])

      function patchDsh(fn) {
        setCfg((prev) => (prev ? { ...prev, dsh: fn(prev.dsh) } : prev))
      }

      function patchAssets(fn) {
        setCfg((prev) => (prev ? { ...prev, assets: fn(prev.assets) } : prev))
      }

      function patchPanel(fn) {
        setCfg((prev) => (prev ? { ...prev, panel: fn(prev.panel) } : prev))
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
        // §7.3 危险动作二次确认：删主体会连带删通道与绑定。
        const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(t('bots.deleteConfirm', { id: botId }))
          : true
        if (!confirmed) return
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
        if (!BOT_ID_RE.test(id)) { setAddErr(t('bots.addInvalid')); return }
        if (cfg && cfg.bots[id]) { setAddErr(t('bots.addDup')); return }
        const platform = newBot.platform.trim() || 'qq'
        if (platform.toLowerCase() === 'dsh') { setAddErr(t('bots.platformInvalid')); return }
        setAddErr('')
        setCfg((prev) => (prev
          ? { ...prev, bots: { ...prev.bots, [id]: normalizeBot({ enabled: true, platform, private: emptyChannel(), group: emptyChannel() }) } }
          : prev))
        setNewBot({ id: '', platform: 'qq' })
      }

      /**
       * 资产行「设为 DSH 默认」：走 POST /select（语义准确、带身份提示回执），
       * 不整份保存草稿，避免把未保存的 bots 改动顺带写盘。
       */
      async function setDshDefault(key) {
        const item = items.find((it) => it.key === key)
        const name = String((item && item.name) || key)
        const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(t('dsh.confirmSetDefault', { name }))
          : true
        if (!confirmed) return
        setAssetErr('')
        setAssetOk('')
        setStatusMsg('')
        try {
          const body = await postJson(`${API}/select`, { key })
          setCfg((prev) => (prev ? { ...prev, dsh: { ...prev.dsh, defaultPersona: key } } : prev))
          // /select 只改了服务端 dsh.defaultPersona：同步 baseline，别把其它草稿误标为干净。
          setBaseline((prev) => {
            try {
              const base = JSON.parse(prev)
              base.dsh = { ...base.dsh, defaultPersona: key }
              return JSON.stringify(base)
            } catch { return prev }
          })
          const hint = body.memoryHinted ? t('dsh.hintSent') : t('dsh.hintSkipped')
          setStatusMsg(`${t('dsh.switched', { name })} ${hint}`)
        } catch (e) {
          setAssetErr(t('err.saveFailed', { message: errorText(t, e.message, e.detail) }))
        }
      }

      /** 重新加载：清 Host 缓存后可发现 fs.watch=false 时改过的正文（再刷资产与预览）。 */
      async function reloadAssets() {
        if (reloading) return
        setReloading(true)
        setAssetErr('')
        setStatusMsg('')
        setWriteFailed(false)
        try {
          await postJson(`${API}/reload`, {})
          await refreshAssets()
          if (preview && preview.key) await openPreview(preview.key)
          setStatusMsg(t('page.reloaded'))
        } catch (e) {
          setAssetErr(t('page.error', { message: e.message || String(e) }))
        } finally {
          setReloading(false)
        }
      }

      async function openPreview(key) {
        setPreviewErr('')
        try {
          const body = await getJson(`${API}/persona?key=${encodeURIComponent(key)}`)
          const meta = body.meta && typeof body.meta === 'object' ? body.meta : {}
          setPreview({
            key: body.key || key,
            name: String(meta.name || ''),
            description: String(meta.description || ''),
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
          setResolveInfo({ reason: String(body.reason || ''), layer: String(body.layer || '') })
          setResolveRan(true)
        } catch (e) {
          setResolveOut(null)
          setResolveInfo({ reason: '', layer: '' })
          setResolveRan(false)
          setResolveErr(t('err.resolveFailed', { message: e.message || String(e) }))
        } finally {
          setResolveBusy(false)
        }
      }

      /** 只刷新资产列表；保留当前预览 key，被删/消失则清空预览。 */
      async function refreshAssets() {
        const body = await getJson(`${API}/personas`)
        const nextItems = Array.isArray(body.items) ? body.items : []
        setItems(nextItems)
        const assets = body.assets && typeof body.assets === 'object' ? body.assets : null
        if (assets) {
          setAssetsInfo((prev) => ({
            dir: String(assets.dir || ''),
            effectiveDir: String(assets.effectiveDir || prev.effectiveDir || ''),
            watch: assets.watch === true,
            // 只读锁存（writeFailed）在重载时先清；这里如实跟随服务端探测结果。
            writable: assets.writable !== false,
            writeReason: String(assets.writeReason || ''),
          }))
        }
        setPreview((prev) => {
          if (!prev) return prev
          return nextItems.some((it) => it.key === prev.key) ? prev : null
        })
        return nextItems
      }

      async function onImported() {
        setAssetErr('')
        setAssetOk('')
        try {
          await refreshAssets()
        } catch (e) {
          setAssetErr(t('page.error', { message: (e && e.message) || String(e) }))
        }
      }

      /** 写盘失败（只读/磁盘满）：锁定只读态并显示原因，禁用后续导入/删除。 */
      function markWriteFailed(detail) {
        setWriteFailed(true)
        setAssetsInfo((prev) => ({ ...prev, writable: false, writeReason: 'not_writable' }))
        if (detail) setAssetErr(t('err.writeFailed', { message: detail }))
      }

      /** 删用户副本；不 force 时 409 in_use 转成二次确认，shipped/missing 直接如实提示。 */
      async function removeAsset(key, force) {
        setDeleteBusy(key)
        setAssetErr('')
        setAssetOk('')
        try {
          const url = `${API}/personas/${encodeURIComponent(key)}${force ? '?force=1' : ''}`
          await deleteJson(url)
          setForceAsk(null)
          setAssetOk(t('assets.deleted', { key }))
          // 删除已成功：刷新失败只报刷新错误，不回滚成功提示。
          try {
            await refreshAssets()
          } catch (refreshErr) {
            setAssetErr(t('page.error', { message: (refreshErr && refreshErr.message) || String(refreshErr) }))
          }
        } catch (e) {
          const code = String((e && e.message) || '')
          if (!force && e && e.status === 409 && code === 'persona_in_use') {
            setForceAsk({ key, usage: Array.isArray(e.usage) ? e.usage : [] })
          } else if (code === 'persona_shipped_immutable') {
            setAssetErr(t('assets.delShipped'))
          } else if (code === 'persona_missing') {
            setAssetErr(t('assets.delMissing'))
            try { await refreshAssets() } catch { /* 刷新失败不覆盖上面的真实错误 */ }
          } else if (code === 'write_failed') {
            markWriteFailed(String((e && e.detail) || ''))
          } else if (code === 'assets_dir_shipped') {
            setAssetErr(t('err.dirIsShipped'))
          } else {
            setAssetErr(t('err.deleteFailed', { message: code || `HTTP ${e && e.status}` }))
          }
        } finally {
          setDeleteBusy('')
        }
      }

      async function askDelete(key) {
        setAssetErr('')
        setAssetOk('')
        const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(t('assets.delConfirm', { key }))
          : true
        if (!confirmed) return
        await removeAsset(key, false)
      }

      const readOnly = writeFailed || assetsInfo.writable === false
      const readOnlyReason = assetsInfo.writeReason === 'is_file'
        ? t('settings.reasonIsFile')
        : assetsInfo.writeReason === 'is_shipped'
          ? t('settings.reasonIsShipped')
          : t('settings.reasonNotWritable')

      if (status === 'loading') {
        return h('div', { style: css.page, ...scrollRegionProps(t) },
          h('h2', { style: css.pageTitle }, t('page.title')),
          h(Hint, null, t('page.loading')))
      }

      if (status === 'error') {
        return h('div', { style: css.page, ...scrollRegionProps(t) },
          h('h2', { style: css.pageTitle }, t('page.title')),
          h(Hint, { tone: 'error' }, t('page.error', { message: loadErr })),
          h(Row, null, h(Btn, { onClick: () => { void load(true) } }, t('act.retry'))))
      }

      if (!cfg) {
        return h('div', { style: css.page, ...scrollRegionProps(t) },
          h('h2', { style: css.pageTitle }, t('page.title')),
          h(Hint, { tone: 'error' }, t('page.error', { message: 'no_config' })),
          h(Row, null, h(Btn, { onClick: () => { void load(true) } }, t('act.retry'))))
      }

      const botIds = Object.keys(cfg.bots).sort()
      const dshOptions = personaOptions(items, t, cfg.dsh.defaultPersona)
      const missing = missingRefs(cfg, items)
      const dshMissing = Boolean(cfg.dsh.defaultPersona)
        && !items.some((it) => String(it.key || '') === cfg.dsh.defaultPersona)
      const effectiveDir = assetsInfo.effectiveDir || assetsInfo.dir || '—'
      const truncated = Boolean(preview) && preview.text.length > PREVIEW_LIMIT

      return h('div', { style: css.page, ...scrollRegionProps(t) },
        h('header', { style: css.pageHead },
          h('div', null,
            h('h2', { style: css.pageTitle }, t('page.title')),
            h('p', { style: css.pageNote }, t('page.note'))),
          h(Row, { style: { gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
            dirty ? h('span', { style: css.dirtyTag }, t('page.dirty')) : null,
            savedSeq > 0 && !dirty ? h('span', { style: css.okTag }, t('page.saved')) : null,
            h(Btn, {
              disabled: readOnly,
              title: readOnly ? readOnlyReason : t('assets.import'),
              onClick: () => {
                setShowImport(true)
                setTab('personas')
                setAssetErr('')
                setAssetOk('')
                setForceAsk(null)
              },
            }, t('assets.import')),
            h(Btn, {
              disabled: reloading || saving,
              title: t('settings.watchDesc'),
              onClick: () => { void reloadAssets() },
            }, reloading ? t('act.reloading') : t('act.reload')),
            h(Btn, { onClick: () => { void load(true) }, disabled: saving }, t('act.refresh')),
            h(Btn, {
              tone: 'primary',
              disabled: saving || !dirty,
              onClick: () => { void save(cfg) },
            }, saving ? t('act.saving') : t('act.save')))),

        saveErr ? h(Hint, { tone: 'error' }, saveErr) : null,
        statusMsg ? h('p', { style: css.okHint }, statusMsg) : null,
        missing.length > 0
          ? h(Hint, { tone: 'warn' }, t('assets.missingRef', { keys: missing.join(', ') }))
          : null,

        h(TabBar, { tab, onSelect: setTab, t }),

