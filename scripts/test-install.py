#!/usr/bin/env python3
"""Verify installation in a disposable directory, without changing Chrome."""
import json
import plistlib
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOST = 'jp.local.memoryharbor'


def main():
    with tempfile.TemporaryDirectory(prefix='memoriq-install-test-') as directory:
        temporary = Path(directory)
        app = temporary / 'Memoriq.app'
        hosts = temporary / 'NativeMessagingHosts'
        command = [sys.executable, str(ROOT / 'scripts/install.py'),
                   '--destination', str(app), '--host-directory', str(hosts)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr
        manifest_path = hosts / f'{HOST}.json'
        manifest = json.loads(manifest_path.read_text())
        assert manifest['path'] == str((app / 'Contents/MacOS/MemoryHarbor').resolve())
        assert manifest['allowed_origins'] == ['chrome-extension://' +
                (ROOT / 'extension/extension-id.txt').read_text().strip() + '/']
        assert manifest_path.stat().st_mode & 0o777 == 0o600
        snapshot = subprocess.run([manifest['path'], '--snapshot'], capture_output=True, text=True, timeout=15)
        assert snapshot.returncode == 0 and json.loads(snapshot.stdout)['memory']['totalBytes'] > 0

        resources = app / 'Contents/Resources'
        legal_files = {
            'LICENSE': ROOT / 'LICENSE',
            'THIRD_PARTY_NOTICES.md': ROOT / 'THIRD_PARTY_NOTICES.md',
            'extension/LICENSE': ROOT / 'LICENSE',
            'extension/THIRD_PARTY_NOTICES.md': ROOT / 'extension/THIRD_PARTY_NOTICES.md',
            'extension/vendor/drowzy-LICENSE.txt': ROOT / 'extension/vendor/drowzy-LICENSE.txt',
        }
        for relative, source in legal_files.items():
            packaged = resources / relative
            assert packaged.is_file(), f'Missing license or notice in installed app: {relative}'
            assert packaged.read_bytes() == source.read_bytes(), f'License or notice changed: {relative}'

        marker = app / 'must-remain.txt'
        marker.write_text('protected')
        manifest_path.write_text(json.dumps({'name': 'another.host'}))
        denied = subprocess.run(command, capture_output=True, text=True, timeout=30)
        assert denied.returncode != 0
        assert marker.read_text() == 'protected'
        assert json.loads(manifest_path.read_text()) == {'name': 'another.host'}

        manifest_path.write_text(json.dumps(manifest))
        info_path = app / 'Contents/Info.plist'
        with info_path.open('rb') as handle:
            info = plistlib.load(handle)
        with info_path.open('wb') as handle:
            plistlib.dump({**info, 'CFBundleIdentifier': 'another.app'}, handle)
        denied = subprocess.run(command, capture_output=True, text=True, timeout=30)
        assert denied.returncode != 0
        assert marker.read_text() == 'protected'
        with info_path.open('rb') as handle:
            assert plistlib.load(handle)['CFBundleIdentifier'] == 'another.app'
    print('PASS: signed install, real snapshot, license notices preserved, scoped manifest, foreign host/app preserved')


if __name__ == '__main__':
    main()
