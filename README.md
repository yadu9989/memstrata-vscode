# MemStrata™ CL1 Workspace

A thin TypeScript client of the CL1 API; no retrieval, selection, engine or model implementation.
It needs a provisioned MemStrata CL1 service and a scoped grant.
Licensed under the Apache License 2.0 (see [LICENSE](LICENSE)), Copyright 2026 Called It Inc.

Disabled by default. A trusted workspace and the `memstrataCl1.enabled` setting are
required; the Enable command writes that setting, the service URL and the project to
the workspace folder's `.vscode/settings.json`, so check that file before you commit it.
The extension refuses to run in remote windows (Remote-SSH, WSL, Codespaces): the default
service address `http://127.0.0.1:9101` would then mean the remote machine.
Grants live only in VS Code SecretStorage under a service-URL and project key, shared by
every workspace that uses the same URL and project. The remove command deletes that key;
it does not revoke other holders, so revoke the grant at the service separately.

## Owner-invoked commands

- Refresh paginated committed/indexed/searchable status. Freshness is a recorded
  observation, not exact completion timing.
- Inspect context packets with UTF-8 hash, source/session, quote-locator and
  profile checks. This does not prove model consumption.
- Inspect a current source and metadata.
- Import editor text, replace a revision or delete a source after modal consent.
  The service must also accept a write grant. No embedding job starts automatically.

Remote credentials require HTTPS, and the extension refuses redirects.
Grants appear only in Authorization headers, never settings, URLs or webview HTML.
The escaped dashboard has a nonce-limited script policy, no iframe/local-resource
access. No watcher, polling, daemon, telemetry or model-callable
write tool. Optional CL1Options.deadlineMs is 1..120000; commands omit it by default.
If a request times out, the extension stops waiting; the service may still complete it.

Context packets and sources are shown in untitled editors. VS Code may keep a backup of unsaved
untitled documents on disk, so close them without saving and clear VS Code's backups if the text
is sensitive. Deleting a source in MemStrata does not delete these copies.

## Build and audit locally

```console
npm ci --ignore-scripts --registry=https://registry.npmjs.org --no-audit --no-fund
npm run compile
npm test
npm run build
npm run package -- --out <temporary-folder>/extension.vsix
python3 test/audit_vsix.py <temporary-folder>/extension.vsix
```

The audit lists every file, enforces the closed thin-client inventory, rejects
Python/private/model artifacts and credential patterns, and checks package identity.
Development sources, tests, dependencies and source maps are excluded.
Only lockfile dependencies are installed; install scripts are disabled.

Report vulnerabilities as described in [SECURITY.md](SECURITY.md); contributions are described in
[CONTRIBUTING.md](CONTRIBUTING.md).

Never commit a real token. The automated tests run against a mock of the VS Code API; they do not
exercise a real VS Code window, and the audit checks only the packaged files.

For a local Conversational candidate with pairing support, run **MemStrata CL1: Connect to local Assistant** in a trusted workspace. Match the displayed code and approve read-only access in the Assistant. The extension uses the default local runtime and personal project and stores the grant in VS Code SecretStorage. The existing Configure command supports explicitly provisioned grants.

[Trademark policy](https://github.com/yadu9989/memstrata-vscode/blob/main/TRADEMARKS.md)
