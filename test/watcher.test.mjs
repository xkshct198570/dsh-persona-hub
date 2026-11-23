/**
 * 资产 watcher 可重入（R9-08 第 6 项）：assets.dir 变更必须重挂。
 *
 * 锁住：
 *   - createPersonaWatcher 构造不安装，reload() 先卸后装，dispose() 卸载且幂等；
 *   - POST /config 保存后 commitConfig 调用 watcher.reload()（新目录才生效）；
 *   - 真实 fs.watch：切到新目录后，旧目录写入不再触发、新目录写入触发。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

import { createPersonaWatcher } from '../src/host/persona-store.js'
import { createRoutes } from '../src/host/routes.js'
import { createResolver } from '../src/host/resolver.js'
import { readPersona } from '../src/host/persona-store.js'

/** 记录安装/卸载的假 watcher 工厂。 */
function countingFactory() {
  const state = { opened: [], closed: 0 }
  const factory = (target, opts, cb) => {
    const w = {
      target, cb, closed: false,
      on() { return this },
      close() { if (!this.closed) { this.closed = true; state.closed += 1 } },
    }
    state.opened.push(w)
    return w
  }
  return { state, factory }
}

function withTempHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'persona-watch-'))
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = home
  return Promise.resolve()
    .then(() => fn(home))
    .finally(() => {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
      rmSync(home, { recursive: true, force: true })
    })
}

test('可重入：装载前 active=false；每次 reload 先卸后装；dispose 卸载且不再安装', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'assets-a')
    mkdirSync(dir, { recursive: true })
    const cfg = { assets: { dir, watch: true } }
    const { state, factory } = countingFactory()
    const watcher = createPersonaWatcher(cfg, () => {}, { watchFactory: factory })
    assert.equal(watcher.active, false, '构造不得安装')

    assert.equal(watcher.reload(), true)
    assert.equal(watcher.active, true)
    assert.equal(state.opened.length, 3, '两个 prompts 目录 + meta 父目录')

    watcher.reload()
    assert.equal(state.opened.length, 6)
    assert.equal(state.closed, 3, '重挂必须先卸掉上一轮句柄')

    watcher.dispose()
    assert.equal(state.closed, 6)
    assert.equal(watcher.active, false)
    assert.equal(watcher.reload(), false, 'dispose 后 reload 不得复活 watcher')
    assert.equal(state.opened.length, 6)
    watcher.dispose()
    assert.equal(state.closed, 6, 'dispose 幂等')
  })
})

test('watch=false：reload 不产生安装（由 watchPersonas 自身短路）', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'assets-off')
    mkdirSync(dir, { recursive: true })
    const { state, factory } = countingFactory()
    const watcher = createPersonaWatcher({ assets: { dir, watch: false } }, () => {}, { watchFactory: factory })
    watcher.reload()
    assert.equal(state.opened.length, 0)
    assert.equal(watcher.active, true, 'off 的 watcher 句柄仍在，reload 可随时重新判定')
    watcher.dispose()
  })
})

test('真实 fs.watch：切目录后重挂，旧目录不再触发、新目录触发', async () => {
  await withTempHome(async (home) => {
    const dirA = join(home, 'assets-a')
    const dirB = join(home, 'assets-b')
    mkdirSync(dirA, { recursive: true })
    mkdirSync(dirB, { recursive: true })
    const cfg = { assets: { dir: dirA, watch: true } }
    let hits = 0
    const watcher = createPersonaWatcher(cfg, () => { hits += 1 })
    try {
      watcher.reload()
      writeFileSync(join(dirA, 'one.txt'), 'A1', 'utf8')
      await waitFor(() => hits > 0, 400)
      assert.ok(hits > 0, '旧目录写入应触发（基线）')

      cfg.assets.dir = dirB
      watcher.reload()
      const baseline = hits
      writeFileSync(join(dirA, 'two.txt'), 'A2', 'utf8')
      await sleep(350)
      assert.equal(hits, baseline, '旧目录句柄必须已卸载')

      writeFileSync(join(dirB, 'three.txt'), 'B1', 'utf8')
      await waitFor(() => hits > baseline, 500)
      assert.ok(hits > baseline, '重挂后新目录写入必须触发')
    } finally {
      watcher.dispose()
    }
  })
})

async function waitFor(pred, ms) {
  const deadline = Date.now() + ms
  while (!pred() && Date.now() < deadline) await sleep(20)
}

test('POST /config：commitConfig 后 watcher 按当前 assets.dir 重挂', async () => {
  await withTempHome(async (home) => {
    const dirA = join(home, 'cfg-a')
    mkdirSync(dirA, { recursive: true })
    const config = { dsh: { enabled: true, defaultPersona: 'bigfish' }, bots: {}, assets: { dir: '', watch: true }, panel: { allowRemote: false } }
    const reloads = []
    const assetsWatcher = { reload() { reloads.push(String(config?.assets?.dir || '')) } }
    const ctx = {
      fiber: { entry: {} },
      get(name) {
        if (name === 'configEditor') return { async edit(entry, fn) { fn({ dsh: { enabled: true, defaultPersona: 'bigfish' }, bots: {}, assets: { dir: '', watch: true } }); return {} } }
        return undefined
      },
    }
    const hook = { refresh() {} }
    const server = http.createServer(createRoutes({ config, hook, resolver: createResolver({ config, store: { readPersona } }), ctx, assetsWatcher }))
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${server.address().port}`
    try {
      const res = await fetch(base + '/persona-hub/api/config', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: { dsh: { enabled: true, defaultPersona: 'bigfish' }, bots: {}, assets: { dir: dirA, watch: true } } }),
      })
      assert.equal(res.status, 200)
      assert.equal(config.assets.dir, dirA)
      assert.deepEqual(reloads, [dirA], 'commitConfig 必须按新的 assets.dir 重挂一次')
    } finally {
      await new Promise((r) => server.close(r))
    }
  })
})
