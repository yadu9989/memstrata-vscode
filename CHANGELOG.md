# Changelog

## 0.2.0

First release under the Apache License 2.0 (Copyright 2026 Called It Inc.). Earlier 0.1.x releases were distributed under a different licence.

- The extension refuses to run in remote windows (Remote-SSH, WSL, Codespaces).
- The remove-grant command now removes the grant stored for the current or last-configured service URL and project, and reports truthfully when nothing was stored.
- Import and replace confirmations name the editor file, its size and the service URL.
- The sidebar view ID is now `memstrataCl1.sidebar` (was an older internal name). A saved view layout may reset once.
- Documentation, settings descriptions and package metadata clarified.
