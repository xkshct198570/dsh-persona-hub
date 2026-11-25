/**
 * dsh-persona-hub Client 半：全平台多主体人设路由中枢（面板）。
 *
 * 只做展示与配置编辑；真正的路由解析在 Host 的 resolver / 网关上。
 * 页面结构（三页签，panel.tab 决定初始页签）：
 *   personas —— 角色资产（预览/导入/删除/设为默认）+ 网页端（DSH）卡片
 *   bots     —— 每个 bot 的开关/平台/私聊/群聊/绑定表/删除 + 添加主体
 *   debug    —— 路由调试（reason/layer 中文诊断）+ 设置卡（assets.* / panel.*）
 * 头部：导入人设、重新加载、刷新、保存（一次 POST 全量，失败如实报错）
 *
 * 规范：手写 React.createElement、零构建；只用 --dsw-alias-* 主题 token；
 * 不 import 宿主 Client 包；不写 document.body；不用 iframe。
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-hub',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'dsh-persona-hub'
    const PANEL_ID = 'persona-hub'
    const API = '/persona-hub/api'
    // 与 Host 对齐：key 规则、bot_id 规则、正文上限、文件体积上限（字符 × 4 字节的宽松界）。
    const KEY_RE = /^[a-z][a-z0-9_-]{0,31}$/
    const BOT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/
    const MAX_TEXT_CHARS = 200000
    const MAX_FILE_BYTES = 4 * 1024 * 1024
    const PREVIEW_LIMIT = 20000
    const TABS = [
      ['personas', 'page.tabPersonas'],
      ['bots', 'page.tabBots'],
      ['debug', 'page.tabDebug'],
    ]

