# dsh-persona-hub

全平台多主体人设路由中枢（DeepSeek Harness 插件）。

**状态：S1.5（0.3.0，未发布）** —— 多主体配置、级联解析、资产分离/热重载、跨进程查询口已就位；面板编辑器在 S3 打磨。

## 它解决什么

- 网页端（DSH）要一个默认角色，新建会话即可用；
- 多个机器人主体（不限 QQ）各有私聊/群聊默认角色与按目标号的特例；
- Python 网关或未来任何外部框架，通过一个稳定 HTTP 接口问"C 包：这个主体/会话该用谁"，不用读插件代码。

## 配置结构

```ts
{
  dsh: { enabled: boolean; defaultPersona: string },
  bots: Record<botId, {
    enabled: boolean;
    platform: string;                 // 默认 qq；其他平台只作标注
    private: { enabled: boolean; defaultPersona: string; bindings: Record<targetId, personaKey> },
    group:   { enabled: boolean; defaultPersona: string; bindings: Record<targetId, personaKey> },
  }>,
  assets: { dir: string; watch: boolean },
  panel: { allowRemote: boolean; pollMs: number },
}
```

**降级链**（任一层关闭/缺键 → `null`，调用方兜底）：
`source=dsh` → `dsh.defaultPersona`；
`source=其他` → `bots[bot_id].enabled` → `chat_type` 通道 → `bindings[target_id]` → `defaultPersona` → 资产文件。

## 资产（纯文本 + 元数据分离）

```
personas/prompts/<key>.txt     # 纯 Prompt 正文（默认 bigfish/aluna/yiyi）
personas/meta.json             # {"bigfish":{"name":"大肥鱼","avatar":""}}
```

用户目录 `$DSH_HOME/persona-hub/prompts/` + `meta.json` 同名覆盖出厂资产；`fs.watch` 热重载（150ms 防抖）。

## 导入/删除人设（面板）

- 面板「角色资产」→「导入人设」：选择 **UTF-8 纯文本** `.txt`/`.md`（无 front matter、无 YAML），填写 key（`^[a-z][a-z0-9_-]{0,31}$`）/显示名/头像（可选）；同名或出厂同名需勾「覆盖」。
- 资产列表：出厂角色标「出厂（只读）」不可删；用户导入的显示「删除」。
- 删除被 DSH/bots 引用的人设时，会列出引用位置并二次确认（`force=1` 才强删）；出厂角色不可删，只能覆盖成用户副本。
- CLI 同能力：`node scripts/import-persona.mjs <src.txt> [key] [name]`。
- 文件落点：`$DSH_HOME/persona-hub/prompts/<key>.txt`，元数据 `$DSH_HOME/persona-hub/meta.json`；写盘 tmp→fsync→rename。

## Service / 跨进程契约

- 宿主内：`ctx.get('personaHub').resolvePersona({ source, bot_id, chat_type, target_id })` → `{personaKey,name,avatar,text} | null`；`explainResolve` 带因返回。
- 跨进程：C 在 `apply`/保存/切换后**原子写** `$DSH_HOME/persona-hub/config.json`（tmp+rename，0600）；Python 网关 `utils/persona_reader.py` 直读该文件与 `prompts/<key>.txt`，不经过任何 HTTP 代理。
- C 不做跨进程 HTTP 人设接口；面板 API 只服务本机 UI。

## 边界

- 管：角色资产、多主体路由、网页端注入、切换、预览、配置。
- 不管：记忆读写/召回（A 包）；QQ 端人设硬路由（Python 网关按 `message_type` 决定，本包不接管）。
