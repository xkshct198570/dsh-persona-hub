/**
 * dsh-persona-hub Client 半：全平台多主体人设路由中枢（面板）。
 *
 * 只做展示与配置编辑；真正的路由解析在 Host 的 resolver / 网关上。
 * 页面结构（三页签，panel.tab 决定初始页签）：
 *   personas —— 角色资产（预览/导入/删除/设为默认）+ 网页端（DSH）卡片
 *   bots     —— 每个 bot 的开关/平台/私聊/群聊/绑定表/删除 + 添加主体
 *   debug    —— 路由调试（reason/layer 中文诊断）+ 设置卡（assets.* / panel.*）
 * 头部：导入人设、重新加载、刷新、保存（一次 POST 全量，失败如实报错）
 *
 * 规范：手写 React.createElement、零构建；只用 --dsw-alias-* 主题 token；
 * 不 import 宿主 Client 包；不写 document.body；不用 iframe。
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-hub',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'dsh-persona-hub'
    const PANEL_ID = 'persona-hub'
    const API = '/persona-hub/api'
    // 与 Host 对齐：key 规则、bot_id 规则、正文上限、文件体积上限（字符 × 4 字节的宽松界）。
    const KEY_RE = /^[a-z][a-z0-9_-]{0,31}$/
    const BOT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/
    const MAX_TEXT_CHARS = 200000
    const MAX_FILE_BYTES = 4 * 1024 * 1024
    const PREVIEW_LIMIT = 20000
    const TABS = [
      ['personas', 'page.tabPersonas'],
      ['bots', 'page.tabBots'],
      ['debug', 'page.tabDebug'],
    ]

    // ---------------------------------------------------------------- 文案（唯一真源：locale/*.json）

    // >>> locale:generated（由 scripts/i18n-check.mjs --write 生成，勿手改）
    const dict = {"zh":{"meta.title":"人设路由中枢","meta.description":"全平台多主体人设路由中枢：网页端注入当前角色；QQ 等平台按「主体 × 私聊/群 × 目标」级联解析唯一人设。正文存 $DSH_HOME/persona-hub/prompts/<key>.txt，元数据存 meta.json；不发网络请求、不写记忆库。关掉插件＝网页端不再注入人设，资产保留。","meta.detail":"docs/DETAIL.zh.md","act.close":"关闭","act.delete":"删除主体","act.preview":"预览","act.refresh":"刷新","act.reload":"重新加载","act.reloading":"重新加载中…","act.remove":"移除","act.resolve":"解析","act.retry":"重试","act.save":"保存","act.saving":"保存中…","act.setDefault":"设为 DSH 默认","assets.chars":"{chars} 字","assets.delConfirm":"删除角色「{key}」？此操作不可撤销。","assets.delInUse":"角色「{key}」仍被引用：","assets.delInUseAsk":"强制删除后，这些引用会指向不存在的角色（列表中显示为「未命名」）。确认强制删除？","assets.delMissing":"角色不存在（可能已被删除）。刷新后重试。","assets.delShipped":"出厂角色不可删，只能覆盖。","assets.delete":"删除","assets.deleted":"已删除「{key}」。","assets.deleting":"删除中…","assets.description":"描述","assets.dir":"资产目录","assets.empty":"资产为空。","assets.forceDelete":"强制删除","assets.import":"导入人设","assets.keep":"保留","assets.label":"{name}（{key}）","assets.missingRef":"配置指向缺失角色：{keys}。对应层将不注入人设。","assets.missingTag":"缺资产","assets.off":"关","assets.on":"开","assets.previewHint":"点击上面的角色查看正文；面板不改写资产文件。","assets.previewTitle":"预览：{key}","assets.readonly":"只读预览","assets.readonlyDir":"资产目录不可写（{reason}）：导入与删除已禁用。","assets.shipped":"出厂（只读）","assets.title":"角色资产","assets.truncated":"仅显示前 {shown} 字（共 {total} 字）。","assets.unknownName":"未命名","assets.watch":"监听变更","bots.addAction":"添加主体","bots.addDup":"该主体已存在。","bots.addId":"主体 ID","bots.addInvalid":"主体 ID 不合法：只允许字母、数字与 . _ : -，最长 128。","bots.addMissing":"请先填写主体 ID。","bots.addPlatform":"平台","bots.deleteConfirm":"删除主体「{id}」？会一并移除它的私聊/群聊通道与特例绑定，保存后生效。","bots.empty":"还没有主体。在下面添加一个 bot id。","bots.enabled":"启用主体","bots.hint":"主体 id 不限于 QQ 号：任何平台的机器人/账号 id 都可以；platform 是解析时的来源匹配值（查询的 source 必须与它相等）。","bots.platform":"平台","bots.platformInvalid":"平台名不能为空，也不能是保留字 dsh。","bots.title":"主体","chan.bindAdd":"添加绑定","chan.bindNeedPersona":"请先选择绑定角色。","chan.bindNeedTarget":"请先填写目标号。","chan.bindPersona":"绑定角色","chan.bindTarget":"目标号","chan.bindings":"特例绑定","chan.bindingsEmpty":"暂无绑定，按默认角色处理。","chan.default":"默认角色","chan.enabled":"启用通道","chan.group":"群聊","chan.private":"私聊","dsh.confirmSetDefault":"切换网页端人设为「{name}」并立即保存？这会改变注入人设，并向记忆中枢发送身份提示。","dsh.default":"默认角色","dsh.enabled":"启用网页端人设","dsh.hintSent":"身份提示已发送给记忆中枢。","dsh.hintSkipped":"记忆中枢未安装，身份提示已跳过。","dsh.switched":"已切换网页端人设为「{name}」。","dsh.title":"网页端（DSH）","err.deleteFailed":"删除失败：{message}","err.dirIsShipped":"资产目录指向插件出厂目录（只读）：导入与删除已禁用，请先在设置里改资产目录。","err.invalidConfig":"配置不合法：{message}","err.personaKeyInvalid":"角色 key 不合法：须以小写字母开头，只含 a-z0-9_-，最长 32 字符（留空＝该层不设）。","err.mirrorFailed":"配置已保存，但跨进程镜像写入失败（Python 网关可能读到旧配置）。","err.previewFailed":"预览失败：{message}","err.readOnlyRemote":"远端只读：配置与人设正文只在本机可看，远端仅能浏览角色列表。","err.resolveFailed":"解析失败：{message}","err.saveFailed":"保存失败：{message}","err.writeFailed":"写入失败：{message}","imp.avatar":"头像（可选）","imp.cancel":"取消","imp.done":"已导入「{key}」（{chars} 字）。","imp.exists":"同名角色已存在，勾选「覆盖同名」后重试。","imp.existsShipped":"出厂已有同名角色，勾选「覆盖同名」后重试（会生成用户副本）。","imp.failed":"导入失败：{message}","imp.file":"文本文件","imp.fileHint":"选择 .txt / .md（UTF-8 纯文本）","imp.fileReadFailed":"读取文件失败：{message}","imp.fileTooLarge":"文件过大（{size}），上限 4 MB。","imp.key":"key","imp.keyInvalid":"key 不合法：须以小写字母开头，只含 a-z0-9_-，最长 32 字符。","imp.name":"显示名","imp.overwrite":"覆盖同名（含出厂同名）","imp.rules":"格式：UTF-8 纯文本（.txt / .md 均可，无 front matter、无 YAML），上限 200000 字符；key 规则 ^[a-z][a-z0-9_-]{0,31}$（小写字母开头，最长 32）。","imp.submit":"导入","imp.submitting":"导入中…","imp.textEmpty":"文本为空：文件里没有可导入的正文。","imp.title":"导入人设","imp.tooLarge":"文本超限：最多 200000 字符（当前 {chars}）。","opt.none":"（不设置）","opt.unset":"（未选择）","page.dirty":"有未保存的修改","page.error":"加载失败：{message}","page.loading":"加载中…","page.note":"网页端与各平台主体共用一套角色资产；按「主体 → 会话类型 → 目标号」逐层回落，任一层关闭即兜底。","page.reloadNeeded":"已保存。assets 组（目录/监听）需重挂插件后生效。","page.reloaded":"已重新读取人设资产。","page.saved":"已保存","page.tabBots":"主体与通道","page.tabDebug":"调试与设置","page.tabPersonas":"角色与资产","page.title":"人设路由中枢","res.bot":"主体","res.bot_disabled":"主体已关闭","res.bot_id_required":"缺少主体 ID（bot_id 为空）","res.bot_unknown":"主体未配置（bots 里没有该 ID）","res.busy":"解析中…","res.chatType":"会话类型","res.chat_type_disabled":"该会话类型已关闭","res.chat_type_invalid":"会话类型非法（只接受 private/group）","res.default_persona_unset":"该层默认角色为空","res.dsh_disabled":"网页端人设已关闭","res.hint":"按当前配置解析一次，验证分层关闭/缺键是否落到兜底（null）。","res.layer":"终止层","res.needBot":"请先选择主体。","res.noneReason":"未命中：{reason}","res.persona_asset_missing":"人设资产缺失、为空或超限","res.platform_mismatch":"平台不匹配（主体 platform 与来源不同）","res.resolve_error":"判定内部异常","res.source":"来源","res.sourceBot":"平台主体","res.sourceDsh":"网页端（dsh）","res.source_missing":"未指定来源（source 为空）","res.target":"目标号","res.title":"路由调试","settings.allowRemote":"允许远程访问","settings.allowRemoteDesc":"允许非回环地址读 /persona-hub/api/*；只额外放行 webServer 绑定地址（默认只允许本机）。","settings.defaultLabel":"默认","settings.dirDefault":"默认：$DSH_HOME/persona-hub/prompts","settings.dirDesc":"人设正文目录；留空使用默认目录。","settings.effectInstant":"即时","settings.effectLabel":"生效","settings.effectReload":"重挂","settings.groupAssets":"资产","settings.groupPanel":"面板","settings.pollInvalid":"轮询间隔需在 5000–600000 毫秒之间。","settings.pollMs":"轮询间隔（毫秒）","settings.pollMsDesc":"面板自动刷新间隔（毫秒，5000–600000）。","settings.reasonIsFile":"路径是文件而不是目录","settings.reasonIsShipped":"资产目录是插件出厂目录（只读）","settings.reasonNotWritable":"目录或上级目录不可写","settings.tab":"默认页签","settings.tabDesc":"面板打开时的默认页签。","settings.title":"设置（资产与面板）","settings.watchDesc":"监听资产目录与 meta.json；关闭后只在点「重新加载」时重读。"},"en":{"meta.title":"Persona Routing Hub","meta.description":"Multi-bot persona routing hub: injects the current persona on the web, and resolves one persona for other platforms by bot × private/group × target cascading. Texts live in $DSH_HOME/persona-hub/prompts/<key>.txt and metadata in meta.json; no network requests, no memory writes. Disabling the plugin stops web injection and keeps existing assets.","meta.detail":"docs/DETAIL.md","act.close":"Close","act.delete":"Delete bot","act.preview":"Preview","act.refresh":"Refresh","act.reload":"Reload","act.reloading":"Reloading…","act.remove":"Remove","act.resolve":"Resolve","act.retry":"Retry","act.save":"Save","act.saving":"Saving…","act.setDefault":"Set as DSH default","assets.chars":"{chars} chars","assets.delConfirm":"Delete persona “{key}”? This cannot be undone.","assets.delInUse":"Persona “{key}” is still referenced:","assets.delInUseAsk":"Forcing the delete leaves those references pointing at a missing persona (shown as “unnamed”). Delete anyway?","assets.delMissing":"Persona not found (it may already be deleted). Refresh and retry.","assets.delShipped":"Shipped personas cannot be deleted; import with overwrite instead.","assets.delete":"Delete","assets.deleted":"Deleted “{key}”.","assets.deleting":"Deleting…","assets.description":"Description","assets.dir":"Asset directory","assets.empty":"No assets.","assets.forceDelete":"Force delete","assets.import":"Import persona","assets.keep":"Keep","assets.label":"{name} ({key})","assets.missingRef":"Config points at missing personas: {keys}. Those layers inject no persona.","assets.missingTag":"missing","assets.off":"off","assets.on":"on","assets.previewHint":"Click a persona above to read its text; the panel never writes asset files.","assets.previewTitle":"Preview: {key}","assets.readonly":"Read-only preview","assets.readonlyDir":"Asset directory is not writable ({reason}); import and delete are disabled.","assets.shipped":"Shipped (read-only)","assets.title":"Persona assets","assets.truncated":"Showing the first {shown} of {total} characters.","assets.unknownName":"unnamed","assets.watch":"Watch changes","bots.addAction":"Add bot","bots.addDup":"That bot already exists.","bots.addId":"Bot ID","bots.addInvalid":"Invalid bot ID: letters, digits and . _ : - only, 128 characters max.","bots.addMissing":"Enter a bot ID first.","bots.addPlatform":"Platform","bots.deleteConfirm":"Delete bot “{id}”? Its private/group channels and bindings are removed too; takes effect after saving.","bots.empty":"No bots yet. Add a bot id below.","bots.enabled":"Enable bot","bots.hint":"Bot ids are not limited to QQ numbers: any platform bot/account id works; platform is the source label resolution matches (the queried source must equal it).","bots.platform":"Platform","bots.platformInvalid":"Platform must not be empty and cannot be the reserved name dsh.","bots.title":"Bots","chan.bindAdd":"Add binding","chan.bindNeedPersona":"Pick a persona to bind first.","chan.bindNeedTarget":"Enter a target id first.","chan.bindPersona":"Persona","chan.bindTarget":"Target id","chan.bindings":"Per-target bindings","chan.bindingsEmpty":"No bindings; the default persona applies.","chan.default":"Default persona","chan.enabled":"Enable channel","chan.group":"Group chat","chan.private":"Private chat","dsh.confirmSetDefault":"Switch the web persona to “{name}” and save now? This changes the injected persona and sends an identity hint to the memory hub.","dsh.default":"Default persona","dsh.enabled":"Enable web persona","dsh.hintSent":"Identity hint sent to the memory hub.","dsh.hintSkipped":"Memory hub not installed; identity hint skipped.","dsh.switched":"Web persona switched to “{name}”.","dsh.title":"Web client (DSH)","err.deleteFailed":"Delete failed: {message}","err.dirIsShipped":"The asset directory points at the plugin’s shipped directory (read-only): import and delete are disabled; change the asset directory in settings.","err.invalidConfig":"Invalid config: {message}","err.personaKeyInvalid":"Invalid persona key: start with a lowercase letter, only a-z0-9_-, 32 characters max (empty means unset).","err.mirrorFailed":"Config saved, but the cross-process mirror write failed (the Python gateway may read stale config).","err.previewFailed":"Preview failed: {message}","err.readOnlyRemote":"Remote read-only: config and persona text are visible on the local machine only; remote clients can browse the persona list.","err.resolveFailed":"Resolve failed: {message}","err.saveFailed":"Save failed: {message}","err.writeFailed":"Write failed: {message}","imp.avatar":"Avatar (optional)","imp.cancel":"Cancel","imp.done":"Imported “{key}” ({chars} chars).","imp.exists":"That key already exists; tick “Overwrite same key” and retry.","imp.existsShipped":"A shipped persona already uses that key; tick “Overwrite same key” and retry (creates a user copy).","imp.failed":"Import failed: {message}","imp.file":"Text file","imp.fileHint":"Pick a .txt / .md file (UTF-8 plain text)","imp.fileReadFailed":"Failed to read the file: {message}","imp.fileTooLarge":"File too large ({size}); 4 MB max.","imp.key":"key","imp.keyInvalid":"Invalid key: start with a lowercase letter, only a-z0-9_-, 32 characters max.","imp.name":"Display name","imp.overwrite":"Overwrite same key (including shipped)","imp.rules":"Format: UTF-8 plain text (.txt / .md, no front matter, no YAML), 200000 characters max; key rule ^[a-z][a-z0-9_-]{0,31}$ (lowercase letter first, 32 characters max).","imp.submit":"Import","imp.submitting":"Importing…","imp.textEmpty":"Empty text: the file has no body to import.","imp.title":"Import persona","imp.tooLarge":"Text too large: 200000 characters max (currently {chars}).","opt.none":"(not set)","opt.unset":"(not selected)","page.dirty":"Unsaved changes","page.error":"Failed to load: {message}","page.loading":"Loading…","page.note":"The web client and every platform bot share one persona library; resolution falls back per bot → chat type → target, and any disabled layer yields the fallback.","page.reloadNeeded":"Saved. The assets group (directory/watch) takes effect after remounting the plugin.","page.reloaded":"Persona assets re-read.","page.saved":"Saved","page.tabBots":"Bots & channels","page.tabDebug":"Debug & settings","page.tabPersonas":"Personas & assets","page.title":"Persona Routing Hub","res.bot":"Bot","res.bot_disabled":"Bot is disabled","res.bot_id_required":"Missing bot ID (bot_id is empty)","res.bot_unknown":"Bot not configured (no such ID in bots)","res.busy":"Resolving…","res.chatType":"Chat type","res.chat_type_disabled":"That chat type is disabled","res.chat_type_invalid":"Invalid chat type (only private/group)","res.default_persona_unset":"Default persona is empty for that layer","res.dsh_disabled":"Web persona is disabled","res.hint":"Resolve once against the current config to verify that disabled layers and missing keys fall back to null.","res.layer":"Layer","res.needBot":"Pick a bot first.","res.noneReason":"No match: {reason}","res.persona_asset_missing":"Persona asset missing, empty, or too large","res.platform_mismatch":"Platform mismatch (bot platform differs from source)","res.resolve_error":"Resolution failed internally","res.source":"Source","res.sourceBot":"Platform bot","res.sourceDsh":"Web client (dsh)","res.source_missing":"No source given (source is empty)","res.target":"Target id","res.title":"Routing debug","settings.allowRemote":"Allow remote access","settings.allowRemoteDesc":"Allow non-loopback reads of /persona-hub/api/*; only the webServer.host bind address is additionally allowed (loopback only by default).","settings.defaultLabel":"Default","settings.dirDefault":"Default: $DSH_HOME/persona-hub/prompts","settings.dirDesc":"Persona text directory; leave empty to use the default directory.","settings.effectInstant":"instant","settings.effectLabel":"Effect","settings.effectReload":"remount","settings.groupAssets":"Assets","settings.groupPanel":"Panel","settings.pollInvalid":"Poll interval must be between 5000 and 600000 ms.","settings.pollMs":"Poll interval (ms)","settings.pollMsDesc":"Panel auto-refresh interval in milliseconds (5000–600000).","settings.reasonIsFile":"the path is a file, not a directory","settings.reasonIsShipped":"the asset directory is the plugin’s shipped directory (read-only)","settings.reasonNotWritable":"directory or an ancestor is not writable","settings.tab":"Default tab","settings.tabDesc":"Default tab when the panel opens.","settings.title":"Settings (assets & panel)","settings.watchDesc":"Watch the asset directory and meta.json; when off, text is re-read only by clicking Reload."}}
    // <<< locale:generated

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
      // 远端只读面：中文界面不许直出英文服务端码。
      if (raw === 'read_only_remote') return t('err.readOnlyRemote')
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

    // ---------------------------------------------------------------- 页签与设置

    function TabBar({ tab, onSelect, t }) {
      return h('div', { style: css.tabBar, role: 'tablist' },
        TABS.map(([id, labelKey]) => h('button', {
          key: id,
          type: 'button',
          role: 'tab',
          'aria-selected': tab === id ? 'true' : 'false',
          onClick: () => onSelect(id),
          style: tab === id ? { ...css.tab, ...css.tabActive } : css.tab,
        }, t(labelKey))))
    }

    function SettingRow({ t, label, desc, defaultText, effect, children }) {
      return h('div', { style: css.settingRow },
        h('div', { style: css.settingHead },
          h('span', { style: css.settingLabel }, label),
          h('span', { style: css.settingMeta }, `${t('settings.defaultLabel')}: ${defaultText}`),
          h('span', { style: css.settingMeta }, `${t('settings.effectLabel')}: ${effect}`)),
        children,
        desc ? h('p', { style: css.settingDesc }, desc) : null)
    }

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
          if (!before || JSON.stringify(before.assets) !== JSON.stringify(target.assets)) {
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
        // 宿主 .centerCol 是 overflow:hidden，面板必须自建滚动：整页只有这一处纵向滚动。
        flex: '1 1 auto',
        minHeight: 0,
        overflowY: 'auto',
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--dsw-alias-border-l1) transparent',
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
      tabBar: {
        display: 'flex',
        gap: '4px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        paddingBottom: '2px',
        flexWrap: 'wrap',
      },
      tab: {
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        border: '1px solid transparent',
        borderRadius: '6px 6px 0 0',
        padding: '5px 12px',
        fontSize: '12px',
        cursor: 'pointer',
      },
      tabActive: {
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        borderColor: 'var(--dsw-alias-border-l1)',
        fontWeight: 600,
      },
      tabPanel: { display: 'flex', flexDirection: 'column', gap: '12px' },
      dangerTag: {
        fontSize: '11px',
        color: 'var(--dsw-alias-state-error-primary)',
        border: '1px solid var(--dsw-alias-state-error-primary)',
        borderRadius: '999px',
        padding: '1px 8px',
        whiteSpace: 'nowrap',
      },
      settingGroupTitle: {
        fontSize: '12px',
        fontWeight: 600,
        marginTop: '2px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      settingRow: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
        paddingTop: '8px',
      },
      settingHead: { display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' },
      settingLabel: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      settingMeta: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
      settingDesc: { fontSize: '11px', lineHeight: 1.6, margin: 0, color: 'var(--dsw-alias-label-secondary)' },
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
      importBox: {
        border: '1px dashed var(--dsw-alias-border-l2)',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-1)',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      },
      fileInput: {
        fontSize: '12px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'transparent',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '6px',
        padding: '3px 6px',
        maxWidth: '320px',
      },
      checkRow: {
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
        cursor: 'pointer',
        width: 'fit-content',
      },
      checkLabel: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)' },
      rulesLine: {
        fontSize: '11px',
        lineHeight: 1.6,
        margin: 0,
        color: 'var(--dsw-alias-label-tertiary)',
      },
      okHint: {
        fontSize: '12px',
        lineHeight: 1.6,
        margin: 0,
        color: 'var(--dsw-alias-state-success-primary)',
      },
      shippedTag: {
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '999px',
        padding: '1px 8px',
        whiteSpace: 'nowrap',
      },
      forceAsk: {
        border: '1px solid var(--dsw-alias-state-error-primary)',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-2)',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      },
      usageList: {
        margin: 0,
        paddingLeft: '18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      usageItem: { lineHeight: 1.5 },
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
        // 文案唯一真源：locale/*.json → scripts/i18n-check.mjs 生成的 dict。
        ctx.effect(() => ctx.locale.register(NS, dict), 'persona-hub: locale')
        // R9-07 第 5 条：细滚动条 <style> 只注入一次（按 id 判重，重挂/两插件先后装载都不叠加）。
        ctx.effect(() => { injectScrollbarStyle() }, 'persona-hub: scrollbar-style')
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
