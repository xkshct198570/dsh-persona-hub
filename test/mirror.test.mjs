import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeConfigMirror } from '../src/host/config-mirror.js'

test('config.json 原子写：内容完整、无 tmp 残留', () => {
  const home = mkdtempSync(join(tmpdir(), 'dshhome-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const cfg = { dsh: { enabled: true, defaultPersona: 'bigfish' }, bots: { '10001': {
      enabled: true, platform: 'qq',
      private: { enabled: true, defaultPersona: 'aluna', bindings: { '20002': 'yiyi' } },
      group: { enabled: true, defaultPersona: 'yiyi', bindings: {} } } } }
    const path = writeConfigMirror(cfg, { promptsDir: '/p', metaFile: '/m', fallbackPromptsDir: '/f' })
    const body = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(body.version, 1)
    assert.equal(body.bots['10001'].private.bindings['20002'], 'yiyi')
    assert.equal(body.promptsDir, '/p')
    assert.equal(body.fallbackPromptsDir, '/f')
    const leftovers = readdirSync(join(home, 'persona-hub')).filter((f) => f.includes('.tmp-'))
    assert.deepEqual(leftovers, [])
  } finally { if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old }
})
