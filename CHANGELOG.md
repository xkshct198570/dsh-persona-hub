# Changelog

## 0.5.3 — 2026-11-25（内部重构，零用户可见行为变化）

- 内部重构：client 字节分片（14 片 + MANIFEST）与 `generated/locale.js` 生成块，build/compare/lint-size 门禁固化。
- 接口、配置项与面板行为不变；测试基线 146（146 pass / 0 fail），client 产物 sha `4ef4f2c0…` 不变，`npm pack` 42 项/93,416 B。

## 0.5.2 — 2026-11-24（未发布 · R11 性能与终审）

- `loadMeta` 增 mtime+size 缓存：hook 每轮读角色名/描述不再重复解析出厂 meta 与用户 meta；文件改写后按 mtime/size 自动失效，坏 JSON 仍整体忽略回退出厂值。
- 测试 145（145 pass / 0 fail）：新增 meta 缓存失效回归（改写/坏 JSON 两条路径）。

## 0.5.1 — 2026-11-24（未发布 · R10 安全与稳定性）

- 读接口也过 Host/Origin 闸：伪造 Host（DNS rebinding）返回 403 `bad_host`，不再能同源读走人设正文/配置。
- `panel.allowRemote` 只额外放行 `webServer.host` 绑定地址；其他外部 Host/Origin 仍拒绝。
- 配置保存保留 cosmokit Volatile Ref 引用身份（`assets.watch` 等宿主后续 volatile 更新不再静默失效）。
- 回归测试：伪造 Host/绑定地址白名单/Origin/IPv6 归一/Ref 保留。


## 0.5.0 — 2026-11-22

- 独立安装/共存加固：鲸忆 `whaleMemory` 服务全程可选（缺失/抛错 fail-open），identity hint 幂等重试；与鲸忆同时安装时 section/context、服务名、配置键无冲突。
- 资产安全：`assets.dir` 指向包内 `personas/`（含 symlink）时只读，导入/删除返回 409，避免改坏随包资产。
- 市场详情：`DETAIL.md`/`DETAIL.zh.md` 恢复功能说明 + 特性图双语版；测试 107、i18n 160 键。

- 面板三页签（角色与资产 / 主体与通道 / 调试与设置）+「设置」卡承载 15 个字段中的非 bot 5 项（`assets.dir/watch`、`panel.allowRemote/pollMs/tab`），每项显示场景/默认/生效；`panel.pollMs` 真用于轮询、`panel.tab` 作初始页签。
- 顶部「重新加载」入口：`POST /reload` 清缓存后再刷资产与预览（`assets.watch=false` 时的手工重读）。
- 导入/删除写盘异常兜成 JSON `{ok:false,error:'write_failed',detail}`；只读目录在面板禁用导入/删除并显示原因。
- `/resolve` 返回 `reason`/`layer`，面板把 11 条降级原因映射成中文诊断。
- 缺资产标红：配置指向不存在 key 时危险徽标 + 顶部提示。
- hook 读失败保留上次快照；空 `defaultPersona` 不再回退出厂 `bigfish`；subagent 判定改用真实 `agents.currentInitiator()` 会话元数据。
- 校验对齐：bot_id 放行 QQ 数字号（`^[A-Za-z0-9._:-]{1,128}$`）、platform 非空且≠`dsh`、bindings 值必须过 key 规则；`enabled` 缺省＝开启（与 Python 网关同口径）。
- 危险动作二次确认（设为 DSH 默认、删除主体）；预览显示描述与截断提示；`assets.dir` 空时显示真实默认路径。
- 说明文案达上架门槛：`docs/DETAIL.md` + `docs/preview.svg` + `locale.meta.detail`；locale 改为单一真源（`scripts/i18n-check.mjs` 生成 client 标记块，CI 校验）；README 重写为用户视角（安装/使用/15 字段/限制/卸载影响）。
- 删除 `scripts/migrate-assets.mjs`（本机已新布局，旧平铺迁移无使用场景）。
- 面板「导入人设/删除人设」：UTF-8 纯文本导入、meta 名称/头像/描述、出厂只读、引用检查与 force 删除；CLI 同步同一实现。

## 0.4.0 — 2026-11-22

- 极简手术：C 原子写 `$DSH_HOME/persona-hub/config.json` 供 Python 直读；key 收紧为 `[a-z][a-z0-9_-]{0,31}`；删除跨进程 HTTP 叙事。

## 0.3.0 — 2026-11-22

- S1.5：多主体（bots）配置与 resolvePersona 级联；资产拆为 prompts/*.txt + meta.json；fs.watch 热重载；跨进程查询口（B 包路由）。
- 移除 active.json（选择改由 Config.dsh.defaultPersona 承担）。

## 0.2.0 — 2026-11-21

- S1 拆分：角色资产（bigfish）、section 注入、切换/预览、身份提示。

## 0.1.0 — 2026-11-21

- S1 骨架。
