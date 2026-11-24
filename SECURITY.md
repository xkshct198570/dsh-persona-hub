# Security policy

Report exploitable issues through a private GitHub security advisory
(`Security` → `Advisories` → `Report a vulnerability`). Non-sensitive hardening
suggestions can be normal issues.

The panel/API is loopback-only by default; `panel.allowRemote` adds read-only access
from the configured bind address. Persona files are read as local UTF-8 text; the
plugin does not make network requests or write memory rows.
