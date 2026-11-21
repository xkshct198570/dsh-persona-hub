/**
 * persona-hub Config（多主体人设路由中枢）。
 *
 * 结构（厂长图纸）：dsh 单列 + bots 以 bot_id 为 key 的字典；每个 bot 下分 private/group，
 * 各有默认角色与按目标号的特例绑定。所有层级都有 enabled 开关，关闭即返回 null（网关兜底）。
 * bot_id 不限于 QQ 号：任何平台的机器人/主体 id 都可用；platform 仅作标注。
 */
import z from '@deepseek-ai/schemastery'

const Channel = z.object({
  enabled: z.boolean().default(true),
  defaultPersona: z.string().default(''),
  bindings: z.dict(z.string()).default({}),
})

export const Config = z.object({
  dsh: z.object({
    enabled: z.boolean().default(true),
    defaultPersona: z.string().default('bigfish'),
  }).default({}),

  bots: z.dict(z.object({
    enabled: z.boolean().default(true),
    platform: z.string().default('qq'),
    private: Channel.default({}),
    group: Channel.default({}),
  })).default({}),

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
