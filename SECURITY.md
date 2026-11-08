# Security policy

Do not open a public issue for a suspected vulnerability. Email
`support@memstrata.dev` with reproduction steps, affected version, and impact. You can
also use GitHub's private vulnerability reporting (the "Report a vulnerability" button
on the Security tab of this repository). Do not include real source text, grants,
tokens, or keys.

Reports are handled on a best-effort basis by email. There is no response-time
guarantee, no service-level agreement, and no phone support.

The extension's security boundary is its handling of the scoped grant (VS Code
SecretStorage, Authorization header only), HTTPS for remote endpoints, refused
redirects, a nonce-limited webview, and consent before any write, delete.
The MemStrata service, engine and licensing are separate products.

When a security fix is made, it is released for the latest minor version only.
