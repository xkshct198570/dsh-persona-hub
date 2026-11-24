# dsh-persona-hub · 人设路由中枢

[**English**](README.md) | 中文

**全平台多主体人设路由中枢**（DeepSeek Harness 插件）· 当前版本 **0.5.2**。

一句话：网页端（DSH）与每个平台机器人主体用哪份人设，在这里一处配置、逐层回落；不联网、不写记忆库，只读本机人设文本。

## 安装

- **市场安装**：在 DSH 插件市场搜索「人设路由中枢 / Persona Routing Hub」安装并启用。
- **本地安装**：在插件所在目录执行 `npm link`，然后在 DSH profile 里 link 本包（与其它本地插件相同）。
- 安装后在侧边栏出现 🎭 入口；启用即生效，无需重启 DSH。

## 使用

1. **网页端（DSH）切角色**：面板「角色与资产」→ 点角色行的「设为 DSH 默认」（会二次确认），或改 DSH 卡片的「默认角色」后点「保存」。切换会同时向已安装的记忆中枢发送身份提示（未安装则静默跳过）。
2. **各平台机器人主体**：面板「主体与通道」→ 添加主体（bot id + 平台名）→ 为私聊/群聊分别设置默认角色，或按目标号添加「特例绑定」。解析顺序：`绑定[target_id]` → `通道默认` → `null`（不回退到别的层）。
3. **资产**：角色正文是纯文本（UTF-8，无 front matter），显示名/头像/描述在 `meta.json`。可在面板导入/删除用户副本；出厂角色只读，只能覆盖成用户副本。
4. **调试**：面板「调试与设置」→「路由调试」按当前配置解析一次，命中显示角色，未命中显示 11 条降级原因之一（来源缺失、主体未配置、平台不匹配、该层默认角色为空、资产缺失……）。
5. **热重载**：默认监听资产目录与 `meta.json`（150ms 防抖），改文件后下一轮对话即用新正文；若关闭监听，点顶部「重新加载」手动重读。

> 子代理（subagent）会话不注入网页端人设：按会话元数据 `origin='subagent'` 判定（经 `agents.currentInitiator()` 取真实会话），主会话照常注入；判定失败时 fail-open 注入，不阻断对话。

## 配置

`dsh` 在「角色与资产」、`bots` 在「主体与通道」；`assets` 与 `panel` 在「调试与设置」的设置卡。`dsh/bots/panel` 即时生效，`assets` 组需重挂插件生效。

| 字段 | 默认 | 场景 | 生效 |
|---|---|---|---|
| `dsh.enabled` | `true` | 网页端是否注入人设；关＝只管理人设资产 | 即时 |
| `dsh.defaultPersona` | `'bigfish'` | 网页端当前人设 key（切角色改这里） | 即时 |
| `bots.<id>.enabled` | `true` | 该主体总开关；关＝该主体全部会话不解析 | 即时 |
| `bots.<id>.platform` | `'qq'` | 平台名，必须与查询的 `source` 相等；`dsh` 是保留字 | 即时 |
| `bots.<id>.private.enabled` | `true` | 私聊分支总开关 | 即时 |
| `bots.<id>.private.defaultPersona` | `''` | 私聊无绑定时的人设；空＝该层 null | 即时 |
| `bots.<id>.private.bindings` | `{}` | `target_id → persona key`，命中即最高优先 | 即时 |
| `bots.<id>.group.enabled` | `true` | 群聊分支总开关 | 即时 |
| `bots.<id>.group.defaultPersona` | `''` | 群聊无绑定时的人设；空＝该层 null | 即时 |
| `bots.<id>.group.bindings` | `{}` | `target_id → persona key` | 即时 |
| `assets.dir` | `''` | 人设正文目录；空＝`$DSH_HOME/persona-hub/prompts` | 重挂 |
| `assets.watch` | `true` | 监听资产目录与 meta；关＝只在点「重新加载」时重读 | 重挂 |
| `panel.allowRemote` | `false` | 允许非回环地址**读** `/persona-hub/api/*`；只额外放行 `webServer.host` 绑定地址（默认只允许本机） | 即时 |
| `panel.pollMs` | `60000` | 面板自动刷新间隔（5000–600000 毫秒） | 即时 |
| `panel.tab` | `'personas'` | 面板打开时的默认页签（`personas`/`bots`/`debug`） | 即时 |

`bots` 的 id 允许字母、数字与 `. _ : -`（QQ 纯数字号可直接用），最长 128；`bindings` 的值必须是合法 persona key（`^[a-z][a-z0-9_-]{0,31}$`）。

## 限制

- 人设正文单份硬顶 **200000 字符**，超限该角色拒读（网页端与网关同口径）。
- persona key 只能是 `[a-z][a-z0-9_-]{0,31}`；不支持目录、路径穿越或非 ASCII key。
- 只读本机文件：**不发任何网络请求**、不写记忆库、不接管 QQ 消息流。
- 面板 API 默认只允许回环地址；开放远程前请确认网络边界。
- `assets.dir` / `assets.watch` 改动需要重挂插件（面板会提示）；`dsh`/`bots`/`panel` 即时生效。
- 出厂只带 `bigfish`；其它角色需自行导入（QQ 角色不随开源包发布）。

## 卸载影响

- 卸载插件本身不会删除任何用户数据；但**删除 `$DSH_HOME/persona-hub/` 会丢掉**：用户导入的人设正文与 `meta.json`、以及供 Python 网关直读的 `config.json`（重装后网页端恢复出厂 `bigfish`，QQ 端回落网关旧逻辑）。
- 卸载后网页端不再注入额外人设；Python 网关读不到 `config.json` 时自动走旧逻辑，聊天不中断。
- 想保留人设：卸载前备份 `~/.dsh/persona-hub/prompts/`、`meta.json`、`config.json`。

## 开发与测试

```bash
npm test                      # host / resolver / routes / store / hook / client 契约
npm run check                 # manifest / exports / files / 禁区扫描
node scripts/i18n-check.mjs   # locale 单一真源：键集、空值、占位符、client 生成块
node --check lib/client.js    # 客户端手写产物语法门
```

`lib/client.js` 是手写零构建产物，文案由 `locale/{zh,en}.json` 经 `node scripts/i18n-check.mjs --write` 生成标记块，不要手改标记块。

## 状态

状态：0.5.2 —— 路由内核、跨进程镜像、面板 15 个字段全覆盖、重新加载入口、降级原因诊断、只读态、二次确认与 locale 单源已就位。
仓库：<https://github.com/xkshct198570/dsh-persona-hub> · 问题与发布：Releases。
