/**
 * 远端只读面（P1）：把 `GET /personas` 收敛成不含目标号与绝对路径的视图。
 *
 * 为什么单独一层：routes.js 只做门禁与端点装配；脱敏判据（哪些字段算敏感、绑定关系怎么算）
 * 集中在这里，避免以后读/写面继续往主流程堆字段特例。
 * 依赖方向：routes.js → remote-view.js；本文件不 import 任何 host 模块（纯函数，可直接单测）。
 */

/**
 * 任意主体通道的默认角色或特例绑定引用过的角色 key 集合。
 *
 * @param {unknown} bots 配置里的 bots 组
 * @returns {Set<string>} 被引用的角色 key
 */
export function boundPersonaKeys(bots) {
  const keys = new Set()
  if (!bots || typeof bots !== 'object' || Array.isArray(bots)) return keys
  for (const bot of Object.values(bots)) {
    if (!bot || typeof bot !== 'object') continue
    for (const name of ['private', 'group']) {
      const channel = bot[name]
      if (!channel || typeof channel !== 'object') continue
      if (typeof channel.defaultPersona === 'string' && channel.defaultPersona) keys.add(channel.defaultPersona)
      const bindings = channel.bindings
      if (!bindings || typeof bindings !== 'object') continue
      for (const key of Object.values(bindings)) {
        if (typeof key === 'string' && key) keys.add(key)
      }
    }
  }
  return keys
}

/**
 * 远端可见的角色条目：只保留 key、显示名、来源、是否被主体绑定。
 * 头像/描述/字数不外发（头像可能是绝对路径或 URL，正文与元数据只给回环面板）。
 *
 * @param {Array<{key: string, name?: string, origin?: string}>} items listPersonas 输出
 * @param {unknown} bots 配置里的 bots 组
 * @returns {Array<{key: string, name: string, origin: string, bound: boolean}>} 脱敏条目
 */
export function remotePersonaItems(items, bots) {
  const bound = boundPersonaKeys(bots)
  return (Array.isArray(items) ? items : []).map((item) => ({
    key: String(item?.key || ''),
    name: String(item?.name || ''),
    origin: String(item?.origin || ''),
    bound: bound.has(String(item?.key || '')),
  }))
}

/**
 * 远端可见的资产状态：只保留布尔与短码原因，去掉 dir/effectiveDir 绝对路径。
 *
 * @param {{watch?: unknown, writable?: unknown, writeReason?: unknown}} assets currentAssets() 输出
 * @returns {{watch: boolean, writable: boolean, writeReason: string}} 脱敏资产状态
 */
export function remoteAssets(assets) {
  return {
    watch: assets?.watch === true,
    writable: assets?.writable === true,
    writeReason: String(assets?.writeReason || ''),
  }
}

/**
 * 远端 `GET /personas` 完整响应体（形状锁在 test/remote-read.test.mjs）。
 *
 * @param {unknown} bots 配置里的 bots 组
 * @param {Array<object>} items listPersonas(config) 输出
 * @param {object} assets currentAssets() 输出
 * @param {{enabled: boolean, defaultPersona: string}} dsh 生效的 dsh 组
 * @returns {object} 脱敏响应体
 */
export function remotePersonasPayload({ bots, items, assets, dsh }) {
  return {
    ok: true,
    items: remotePersonaItems(items, bots),
    dsh: { enabled: dsh?.enabled === true, defaultPersona: String(dsh?.defaultPersona || '') },
    assets: remoteAssets(assets),
  }
}
