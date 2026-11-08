# Contributing

Issues are welcome: bug reports, questions and suggestions. Please include the
extension version, VS Code version and operating system, and a description that
contains no real source text, grants, tokens or keys. For a suspected vulnerability,
follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Pull requests

- Every commit in a pull request needs a Developer Certificate of Origin sign-off
  (<https://developercertificate.org/>). Add it with `git commit -s`; the
  `Signed-off-by:` line must match the commit author.
- Contributions are accepted under the Apache-2.0 licence of this repository.
- Do not submit code, prompts, data, or documentation copied from MemStrata's
  commercial products or from any source you cannot license under Apache-2.0.
- Maintainers may decline or close any pull request without a detailed explanation.

## Before opening a pull request

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run compile
npm test
npm run build
npm run package -- --out "$TMPDIR/extension.vsix"
python3 test/audit_vsix.py "$TMPDIR/extension.vsix"
```

## Support

Support is by email at `support@memstrata.dev` and through GitHub issues, on a
best-effort basis. There is no response-time guarantee, no service-level agreement,
and no phone support.
