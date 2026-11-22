/**
 * persona-hub Config（多主体人设路由中枢）。
 *
 * 结构（厂长图纸）：dsh 单列 + bots 以 bot_id 为 key 的字典；每个 bot 下分 private/group，
 * 各有默认角色与按目标号的特例绑定。所有层级都有 enabled 开关：显式 false/0/'' 才关闭
 * （字段缺失＝开启，与 Python `persona_reader` 同口径），关闭即返回 null（调用方兜底）。
 *
 * 校验（§12.4.1）：
 *   - bot_id 允许字母、数字与 . _ : -（QQ 纯数字号必须放行），长度 1–128；
 *   - platform 非空且不能是保留字 `dsh`（大小写不敏感）；
 *   - bindings 的 value 必须是 persona key 形态 `^[a-z][a-z0-9_-]{0,31}$`。
 * schema 只校验类型与 key 形态，不校验资产是否存在（资产可后补；面板标红、resolve 返回 null）。
 */
import z from '@deepseek-ai/schemastery'

export const KEY_RE = /^[a-z][a-z0-9_-]{0,31}$/
export const BOT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/
export const PLATFORM_RE = /^(?!\s*$)(?!dsh\s*$).+$/i

const Channel = z.object({
  enabled: z.boolean().default(true),
  defaultPersona: z.string().default(''),
  bindings: z.dict(z.string().pattern(KEY_RE)).default({}),
})

export const Config = z.object({
  dsh: z.object({
    enabled: z.boolean().default(true),
    defaultPersona: z.string().default('bigfish'),
  }).default({}),

  bots: z.dict(z.object({
    enabled: z.boolean().default(true),
    platform: z.string().pattern(PLATFORM_RE).default('qq'),
    private: Channel.default({}),
    group: Channel.default({}),
  }), z.string().pattern(BOT_ID_RE)).default({}),

  assets: z.object({
    dir: z.string().default(''),
    watch: z.boolean().default(true).volatile(),
  }).default({}),

  panel: z.object({
    allowRemote: z.boolean().default(false).volatile(),
    pollMs: z.natural().min(5000).max(600000).default(60000).volatile(),
    tab: z.union(['personas', 'bots', 'debug']).default('personas').volatile(),
  }).default({}),
})
