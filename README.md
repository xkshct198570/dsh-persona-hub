# dsh-persona-hub

双人设/角色管理（DeepSeek Harness 插件）。

**状态：S1 拆分完成（0.2.0，未发布）** —— 三角色资产、默认 bigfish、section 注入、切换与身份提示已就位；编辑器/对话端点按 S3–S4 落地。

## 出厂角色（`personas/`）

- `bigfish.txt` → 大肥鱼（**DSH 网页端默认**）
- `aluna.txt` → 阿罗娜（QQ 私聊角色；网页端也可选）
- `yiyi.txt` → 一叶（QQ 群角色；网页端也可选）

资产可被 `$DSH_HOME/persona-hub/personas/` 同名文件覆盖；`scripts/import-persona.mjs` 负责迁移外部文本。

## 网页端注入与记忆身份提示

- `systemPrompt.section(order=10)` 注入当前角色（默认 bigfish），静态文本、不插值。
- 切换角色写 `$DSH_HOME/persona-hub/active.json`，并向已安装的记忆插件发身份提示：
  `bigfish → workspace=web, role_id=''`；`aluna → role_id=aluna, workspace=web`；`yiyi → role_id=yiyi, workspace=web`。
- **QQ 端不归本包**：私聊阿罗娜 / 群聊一叶由 Python 网关按 `message_type` 硬路由，本包不接管。

## 边界

- 管：角色资产、网页端默认角色、切换、注入、预览、导入导出。
- 不管：记忆读写、召回、注入（那是记忆插件）、QQ 端人设路由。
