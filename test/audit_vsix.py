# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Called It Inc.
"""Closed inventory audit for the thin-client VSIX; this test is not packaged."""
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

EXPECTED = frozenset({
    '[Content_Types].xml', 'extension.vsixmanifest',
    'extension/package.json', 'extension/out/extension.js', 'extension/readme.md',
    'extension/LICENSE.txt', 'extension/NOTICE', 'extension/TRADEMARKS.md', 'extension/changelog.md', 'extension/media/database.svg', 'extension/media/icon.png',
})
FORBIDDEN_CONTENT = re.compile(
    rb'memory_layer_pro|https?://[^\s"\']*memstrata\.dev'
    rb'|BEGIN [A-Z ]*PRIVATE KEY|cl1_[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9_-]{16,}'
    rb'|sk-[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}'
)


def audit(path):
    rows = []
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)) or set(names) != EXPECTED:
            raise ValueError('Unexpected VSIX file inventory')
        for entry in sorted(entries, key=lambda item: item.filename):
            if entry.is_dir() or entry.file_size > 1_048_576 or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Unsupported VSIX entry')
            raw = archive.read(entry)
            if FORBIDDEN_CONTENT.search(raw):
                raise ValueError('Private code or credential pattern in VSIX')
            rows.append(dict(path=entry.filename, bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest()))
        manifest = json.loads(archive.read('extension/package.json'))
        if (manifest.get('name'), manifest.get('publisher'), manifest.get('version'), manifest.get('main')) != (
                'memstrata-cl1-workspace', 'NeerajYadav9991', '0.2.0', './out/extension.js'):
            raise ValueError('VSIX identity differs')
    return dict(status='PASS', files=rows, file_count=len(rows),
                vsix_sha256=hashlib.sha256(Path(path).read_bytes()).hexdigest(),
                scope='Closed file inventory and credential-pattern audit; does not test installation in VS Code')


if __name__ == '__main__':
    print(json.dumps(audit(sys.argv[1]), indent=2))
