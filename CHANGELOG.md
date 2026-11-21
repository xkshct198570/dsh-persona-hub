# Changelog

## 0.5.0 — 2026-11-22

- 面板「导入人设/删除人设」：UTF-8 纯文本导入、meta 名称/头像、出厂只读、引用检查与 force 删除；CLI 同步同一实现。

## 0.4.0 — 2026-11-22

- 极简手术：C 原子写 `$DSH_HOME/persona-hub/config.json` 供 Python 直读；key 收紧为 `[a-z][a-z0-9_-]{0,31}`；删除跨进程 HTTP 叙事。

## 0.3.0 — 2026-11-22

- S1.5：多主体（bots）配置与 resolvePersona 级联；资产拆为 prompts/*.txt + meta.json；fs.watch 热重载；跨进程查询口（B 包路由）。
- 移除 active.json（选择改由 Config.dsh.defaultPersona 承担）。

## 0.2.0 — 2026-11-21

- S1 拆分：三角色资产、section 注入、切换/预览、身份提示。

## 0.1.0 — 2026-11-21

- S1 骨架。
