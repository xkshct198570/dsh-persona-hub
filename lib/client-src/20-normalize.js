
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
        if (body && typeof body.detail === 'string') e.detail = body.detail
        throw e
      }
      return body
    }

    async function deleteJson(url) {
      const res = await fetch(url, { method: 'DELETE', headers: { accept: 'application/json' } })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body || body.ok === false) {
        const e = new Error((body && body.error) || `HTTP ${res.status}`)
        e.status = res.status
        // 409 persona_in_use 会带 usage[]：面板据此二次确认，不许吞掉。
        if (body && Array.isArray(body.usage)) e.usage = body.usage
        if (body && typeof body.detail === 'string') e.detail = body.detail
        throw e
      }
      return body
    }

    /** 文件名 → key：去目录与扩展名、转小写、非 [a-z0-9_-] 换 '-'、截 32。 */
    function keyFromFileName(name) {
      const base = String(name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '')
      return base.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 32)
    }

    function formatBytes(bytes) {
      const n = Number(bytes) || 0
      return `${(n / (1024 * 1024)).toFixed(1)} MB`
    }

    // >>> test:pure（纯函数块：不依赖 React/fetch，test/client 直接执行）
    /** 开关语义与 Host/网关一致：只有显式 false/0/'' 才算关闭，缺省＝开启。 */
    function enabledValue(raw, fallback = true) {
      if (raw === undefined || raw === null) return fallback
      return !(raw === false || raw === 0 || raw === '')
    }

    /** 导入失败码 → 本地化文案；未知码照实显示服务端 error。 */
    function importErrorText(t, code, status, chars, detail) {
      if (code === 'invalid_key') return t('imp.keyInvalid')
      if (code === 'empty_text') return t('imp.textEmpty')
      if (code === 'persona_exists') return t('imp.exists')
      if (code === 'persona_exists_shipped') return t('imp.existsShipped')
      if (code === 'text_too_large') return t('imp.tooLarge', { chars: String(chars) })
      if (code === 'write_failed') return t('err.writeFailed', { message: detail || code })
      if (code === 'assets_dir_shipped') return t('err.dirIsShipped')
      return t('imp.failed', { message: code || `HTTP ${status}` })
    }

    /** 保存失败码 → 文案（服务端业务码优先，未知码原样显示）。 */
    function errorText(t, code, detail) {
      const raw = String(code || '')
      if (raw === 'write_failed') return t('err.writeFailed', { message: detail || raw })
      if (raw === 'invalid_config' || raw === 'invalid_bots' || raw === 'invalid_assets' || raw === 'invalid_panel') {
        return t('err.invalidConfig', { message: detail || raw })
      }
      return detail || raw
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
        // 空值绑定等于未设置：提交前丢弃，保证 bindings value 全部过 key 规则。
        if (typeof value === 'string' && value) bindings[target] = value
      }
      return {
        enabled: enabledValue(src.enabled),
        defaultPersona: typeof src.defaultPersona === 'string' ? src.defaultPersona : '',
        bindings,
      }
    }

    function normalizeBot(raw) {
      const src = raw && typeof raw === 'object' ? raw : {}
      return {
        enabled: enabledValue(src.enabled),
        platform: typeof src.platform === 'string' && src.platform ? src.platform : 'qq',
        private: normalizeChannel(src.private),
        group: normalizeChannel(src.group),
      }
    }

    function normalizeAssets(raw) {
      const src = raw && typeof raw === 'object' ? raw : {}
      return {
        dir: typeof src.dir === 'string' ? src.dir : '',
        watch: enabledValue(src.watch),
      }
    }

    function normalizePanel(raw) {
      const src = raw && typeof raw === 'object' ? raw : {}
      const pollMs = Number(src.pollMs)
      return {
        allowRemote: src.allowRemote === true,
        pollMs: Number.isFinite(pollMs) && pollMs >= 5000 && pollMs <= 600000 ? Math.floor(pollMs) : 60000,
        tab: TABS.some(([id]) => id === src.tab) ? src.tab : 'personas',
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
          enabled: enabledValue(dshRaw.enabled),
          defaultPersona: typeof dshRaw.defaultPersona === 'string' ? dshRaw.defaultPersona : '',
        },
        bots,
        assets: normalizeAssets(src.assets),
        panel: normalizePanel(src.panel),
      }
    }

    function personaOptions(items, t, selected) {
      const list = [{ value: '', label: t('opt.none') }]
      const seen = new Set([''])
      for (const it of items) {
        const key = String(it.key || '')
        if (!key || seen.has(key)) continue
        seen.add(key)
        list.push({ value: key, label: t('assets.label', { name: String(it.name || key), key }) })
      }
      // 配置里指向了资产中不存在的 key：照实显示并标记「缺资产」，便于发现坏配置。
      if (selected && !seen.has(selected)) {
        list.push({
          value: selected,
          label: `${t('assets.label', { name: t('assets.unknownName'), key: selected })} · ${t('assets.missingTag')}`,
          missing: true,
        })
      }
      return list
    }

    /** 配置里引用的全部角色 key（dsh 默认 + 通道默认 + 绑定）。 */
    function referencedKeys(cfg) {
      const out = new Set()
      if (cfg?.dsh?.defaultPersona) out.add(String(cfg.dsh.defaultPersona))
      for (const bot of Object.values(cfg?.bots || {})) {
        for (const ch of ['private', 'group']) {
          const c = bot?.[ch]
          if (!c) continue
          if (c.defaultPersona) out.add(String(c.defaultPersona))
          for (const key of Object.values(c.bindings || {})) if (key) out.add(String(key))
        }
      }
      return [...out]
    }

    /** 被配置引用但资产里不存在的 key（面板标红 + 顶部提示）。 */
    function missingRefs(cfg, items) {
      const have = new Set((items || []).map((it) => String(it.key || '')))
      return referencedKeys(cfg).filter((key) => !have.has(key)).sort()
    }

    /** reason 码 → 本地化中文/英文（11 条与 §18.7 一一对应）。 */
    function reasonText(t, reason) {
      const code = String(reason || '')
      if (!code) return ''
      const key = `res.${code}`
      const text = t(key)
      return text === key ? code : text
    }

    /** 角色 key：空串＝该层不设；非空必须与 Host/网关同一条规则。 */
    function validPersonaKey(value) {
      return !value || KEY_RE.test(String(value))
    }

    /** 保存前的前端校验（Host 仍会再校验；这里只求即时反馈）。 */
    function validateConfig(t, cfg) {
      if (!validPersonaKey(cfg?.dsh?.defaultPersona)) return t('err.personaKeyInvalid')
      for (const id of Object.keys(cfg?.bots || {})) {
        if (!BOT_ID_RE.test(id)) return t('bots.addInvalid')
        const platform = String(cfg.bots[id]?.platform || '').trim()
        if (!platform || platform.toLowerCase() === 'dsh') return t('bots.platformInvalid')
        for (const ch of ['private', 'group']) {
          const channel = cfg.bots[id]?.[ch]
          if (!channel) continue
          if (!validPersonaKey(channel.defaultPersona)) return t('err.personaKeyInvalid')
          for (const key of Object.values(channel.bindings || {})) {
            if (!validPersonaKey(key)) return t('err.personaKeyInvalid')
          }
        }
      }
      const pollMs = Number(cfg?.panel?.pollMs)
      if (!Number.isInteger(pollMs) || pollMs < 5000 || pollMs > 600000) return t('settings.pollInvalid')
      return ''
    }

    // <<< test:pure

    // ---------------------------------------------------------------- 基础控件

