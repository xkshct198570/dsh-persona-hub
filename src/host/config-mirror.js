/**
 * 跨进程配置镜像：把 dsh/bots 原子写到 `$DSH_HOME/persona-hub/config.json`。
 *
 * 为什么需要：Python 网关不 import 插件、不读 DSH profile patch；它只读这个稳定文件。
 * 写法：同目录 tmp + fsync + rename（rename 原子替换），权限 600、目录 700；
 * 读方永远不会看到半截 JSON。
 */
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs'
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
