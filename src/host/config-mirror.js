/**
 * 跨进程配置镜像：把 dsh/bots 原子写到 `$DSH_HOME/persona-hub/config.json`。
 *
 * 为什么需要：Python 网关不 import 插件、不读 DSH profile patch；它只读这个稳定文件。
 * 写法：同目录 tmp + fsync + rename（rename 原子替换），权限 600、目录 700；
 * 读方永远不会看到半截 JSON。
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome } from './persona-store.js'

export function mirrorPath() {
  return join(dshHome(), 'persona-hub', 'config.json')
}

/**
 * @param {any} config
 * @param {{ promptsDir: string, metaFile: string, fallbackPromptsDir: string }} paths
 * @returns {string} 写入路径
 */
export function writeConfigMirror(config, paths) {
  const path = mirrorPath()
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  const body = {
    version: 1,
    updatedAt: Date.now(),
    dsh: { ...(config?.dsh || { enabled: true, defaultPersona: 'bigfish' }) },
    bots: safeClone(config?.bots || {}),
    promptsDir: paths.promptsDir,
    metaFile: paths.metaFile,
    fallbackPromptsDir: paths.fallbackPromptsDir,
  }
  const text = JSON.stringify(body, null, 2) + '\n'
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  const fd = openSync(tmp, 'w', 0o600)
  try {
    writeSync(fd, text, null, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, path)
  return path
}

function safeClone(value) {
  try { return structuredClone(value) } catch { return JSON.parse(JSON.stringify(value)) }
}

/**
 * 读回镜像配置（P2 保存回读）。写入成功不等于读得到，调用方据此判定是否随响应标记。
 *
 * @param {string} [path] 镜像路径（缺省 `$DSH_HOME/persona-hub/config.json`；测试可显式传）
 * @returns {any} 解析后的镜像对象
 */
export function readConfigMirror(path = mirrorPath()) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** 稳定序列化（对象键排序），用于 bots 结构等价比较，不受键顺序影响。 */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value === undefined ? null : value)
}

/**
 * 回读校验：写盘成功后确认 `config.json` 的 dsh/bots 关键字段与运行时配置一致。
 *
 * 只回短码原因（不含正文/路径）；任何失败都**不**否定已保存的配置——调用方按
 * `readBackFailed` 提示，只有写盘失败才报 ok:false。
 *
 * @param {any} config 运行时配置（已就地更新）
 * @param {string} [path] 镜像路径（缺省真实镜像；测试可显式传）
 * @returns {{ok:true} | {ok:false, reason:'read_failed'|'parse_failed'|'mismatch_dsh'|'mismatch_bots'}}
 */
export function verifyConfigMirror(config, path = mirrorPath()) {
  let body
  try {
    body = readConfigMirror(path)
  } catch (err) {
    return { ok: false, reason: err instanceof SyntaxError ? 'parse_failed' : 'read_failed' }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, reason: 'parse_failed' }

  const expectedDsh = {
    enabled: config?.dsh?.enabled === true,
    defaultPersona: String(config?.dsh?.defaultPersona || ''),
  }
  const gotDsh = {
    enabled: body?.dsh?.enabled === true,
    defaultPersona: String(body?.dsh?.defaultPersona || ''),
  }
  if (stableJson(gotDsh) !== stableJson(expectedDsh)) return { ok: false, reason: 'mismatch_dsh' }
  if (stableJson(body?.bots) !== stableJson(config?.bots)) return { ok: false, reason: 'mismatch_bots' }
  return { ok: true }
}
