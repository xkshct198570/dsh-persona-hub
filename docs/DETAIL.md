![Persona routing hub](preview.svg)

One persona asset set serves the DeepSeek Harness web client and each bot subject. Routing walks **subject → private/group channel → target id** and falls back at every layer; a disabled layer returns `null` so the caller can apply its own default.

## Features

- **Panel editing** — persona list and body preview, import/delete, web default persona, bot/channel/target bindings; saves go through the host config editor and take effect without restarting.
- **Hot reload** — watches the asset directory and `meta.json` (150 ms debounce); with watching off, a manual reload clears the cache and rereads the files.
- **Cross-process mirror** — atomically writes `$DSH_HOME/persona-hub/config.json` for a Python gateway to read directly; the web host being offline does not affect the gateway.
- **Identity hint** — switching the web persona sends a role hint to the installed memory hub and silently skips when that plugin is not installed.
- **Local only** — reads local text files, makes no network request, and writes no memory rows.

## Install

Search “Persona Routing Hub / 人设路由中枢” in the Plugins market (once listed), or install the release tarball:

```bash
dsh plugin --profile <profile> add <dsh-persona-hub.tgz>
```

For development use `link:<repository-directory>`. Requires DSH `>=0.2.2-rc.5 <0.3.0`, Node `>=22.5`.

## Use

1. **Web persona** — *Personas & assets* → set a persona as the DSH default (confirmation required), or edit the DSH card and save.
2. **Bot subjects** — *Subjects & channels* → add a subject, set private/group defaults, or bind a target id. Resolution order: binding → channel default → `null`.
3. **Assets** — plain UTF-8 persona bodies plus `meta.json`; user copies can be imported/deleted, shipped personas are read-only.
4. **Debug** — *Resolve once* shows the matched persona or one of 11 reason codes.
5. **Reload** — with file watching off, use the panel's Reload button.

## Configuration

`dsh.*` and `bots.*` apply immediately; `assets.dir` / `assets.watch` need a plugin remount; `panel.*` controls loopback access, refresh interval and the initial tab. See the README for the full 15-field table.

## Standalone and coexistence

The memory hub is optional: every `whaleMemory` call is guarded, so this plugin works alone and `memoryHinted` is simply false. With Whale Memory installed, the persona uses `systemPrompt.section` (`persona-hub:persona`, order 10) while memory uses `systemPrompt.context` (`whale-memory:recall`, order 100); services and config keys are different. Only `roleId` is sent; workspace stays with the session cwd.

## Privacy and limits

Reads local files only: no network, no memory writes, no QQ message takeover. Persona bodies are capped at 200,000 characters; keys are `[a-z][a-z0-9_-]{0,31}`. The panel API is loopback-only by default; confirm the network boundary before enabling remote access. The open-source package ships one persona (`bigfish`); other personas are user assets.
