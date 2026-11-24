# Persona Routing Hub · 人设路由中枢

[**中文**](README.zh.md) | English

One persona asset set for the DeepSeek Harness web client and for every bot subject. Routing walks **subject → private/group channel → target id** and falls back one layer at a time; a disabled layer returns `null` so the caller can apply its own default. Local text only — no network requests, no memory writes.

> Current version **0.5.2**. DSH `>=0.2.2-rc.5 <0.3.0`, Node `>=22.13.0`. Web client only.

## Install

- **Market**: search for “Persona Routing Hub / 人设路由中枢” in the DSH plugin market (once listed), install and enable.
- **Release tarball**: `dsh plugin --profile <profile> add <dsh-persona-hub.tgz>`, or choose the tarball in the Plugins page.
- **Local development**: install with `link:<absolute-path>` from the plugin manager; run `pnpm install` first and restart after code changes.
- After enabling, a 🎭 entry appears in the sidebar. No API key and no external service are needed.

## Use

1. **Switch the web persona** — *Personas & assets* → set a persona as the DSH default (confirmation required), or edit the DSH card's default persona and save. Switching also sends a role hint to the memory hub when it is installed; otherwise it is skipped silently.
2. **Bot subjects** — *Subjects & channels* → add a subject (bot id + platform), set a default persona for private and group channels, or add target-specific bindings. Resolution order: `binding[target_id]` → `channel default` → `null` (no fallback to another layer).
3. **Assets** — persona bodies are plain UTF-8 text without front matter; display name, avatar and description live in `meta.json`. User copies can be imported/deleted from the panel; shipped personas are read-only and can only be overridden by a user copy.
4. **Debug** — *Debug & settings* → *Resolve once* runs the current configuration and shows either the matched persona or one of the 11 reason codes (missing source, unknown subject, platform mismatch, empty layer default, missing asset, …).
5. **Hot reload** — watches the asset directory and `meta.json` (150 ms debounce); with watching off, use **Reload** in the panel header to clear the cache and reread.

Subagent sessions do not receive the web persona: the hook checks session metadata (`origin='subagent'` via `agents.currentInitiator()`); the main session still gets it, and a failed check fails open.

## Configuration

`dsh` is edited in *Personas & assets*; `bots` in *Subjects & channels*; `assets` and `panel` in *Debug & settings*.

| Field | Default | Meaning | Applies |
|---|---|---|---|
| `dsh.enabled` | `true` | Inject a web persona; off = asset management only | immediately |
| `dsh.defaultPersona` | `'bigfish'` | Current web persona key | immediately |
| `bots.<id>.enabled` | `true` | Subject master switch | immediately |
| `bots.<id>.platform` | `'qq'` | Must equal the queried `source`; `dsh` is reserved | immediately |
| `bots.<id>.private.enabled` | `true` | Private-channel switch | immediately |
| `bots.<id>.private.defaultPersona` | `''` | Private fallback; empty = `null` | immediately |
| `bots.<id>.private.bindings` | `{}` | `target_id → persona key`; highest priority | immediately |
| `bots.<id>.group.enabled` | `true` | Group-channel switch | immediately |
| `bots.<id>.group.defaultPersona` | `''` | Group fallback; empty = `null` | immediately |
| `bots.<id>.group.bindings` | `{}` | `target_id → persona key` | immediately |
| `assets.dir` | `''` | Persona body directory; empty = `$DSH_HOME/persona-hub/prompts` | remount |
| `assets.watch` | `true` | Watch assets and meta; off = reload only from the panel | remount |
| `panel.allowRemote` | `false` | Allow non-loopback access to `/persona-hub/api/*` | immediately |
| `panel.pollMs` | `60000` | Panel refresh interval (5000–600000 ms) | immediately |
| `panel.tab` | `'personas'` | Initial panel tab (`personas` / `bots` / `debug`) | immediately |

Bot ids accept letters, digits and `. _ : -` (numeric QQ ids work), up to 128 characters. Binding values must be valid persona keys (`^[a-z][a-z0-9_-]{0,31}$`).

## Standalone and coexistence

- Standalone: the memory hub is optional. Every `whaleMemory` call is guarded; if the plugin is absent or throws, persona routing and the panel still work and `memoryHinted` is simply false.
- With Whale Memory installed: persona registers `systemPrompt.section` name `persona-hub:persona` order 10; Whale Memory registers `systemPrompt.context` name `whale-memory:recall` order 100. Different registries, names and services; no key overlap. The persona only sends `roleId`; the workspace is derived by the memory hub from the session cwd, so role switches cannot bleed another workspace.
- Asset safety: when `assets.dir` points at the package's shipped `personas/` directory (including through a symlink), import/delete return 409 and the shipped `bigfish` asset cannot be modified.

## Privacy and limits

- Reads local files only: **no network request**, no memory writes, does not take over QQ message flow.
- Persona body is capped at **200,000 characters**; oversized bodies are rejected.
- Persona keys are `[a-z][a-z0-9_-]{0,31}`; no directories, traversal or non-ASCII keys.
- The panel API is loopback-only by default; confirm the network boundary before enabling remote access.
- The open-source package ships one persona, `bigfish`. Other personas are user assets and are not part of the package.

## Uninstall

Uninstalling the plugin does not delete user data. Deleting `$DSH_HOME/persona-hub/` removes imported persona bodies, `meta.json`, and the cross-process `config.json`. The web client then falls back to no extra persona and a Python gateway falls back to its old logic; chat continues.

## Development

```bash
npm test                      # 145 tests: host / resolver / routes / store / hook / client
npm run check                 # manifest / exports / files / forbidden-pattern scan
node scripts/i18n-check.mjs   # locale single source: keys, placeholders, generated client block
node --check lib/client.js    # client bundle syntax gate
```

`lib/client.js` is a hand-written no-build artifact. Locale strings are generated from `locale/{zh,en}.json` by `node scripts/i18n-check.mjs --write`; do not edit the generated block by hand.

## License

MIT.
