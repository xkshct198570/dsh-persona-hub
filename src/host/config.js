/**
 * persona-hub Config（空配置必须通过校验）。
 * personaDir 为空 = $DSH_HOME/persona-hub/personas。
 */
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  personaDir: z.string().default(''),
  defaultPersona: z.string().default('bigfish'),
  injectEnabled: z.boolean().default(true).volatile(),
  maxChars: z.natural().min(100).max(200000).default(20000),
  panel: z.object({
    allowRemote: z.boolean().default(false).volatile(),
    pollMs: z.natural().min(5000).max(600000).default(60000).volatile(),
  }).default({}),
})
