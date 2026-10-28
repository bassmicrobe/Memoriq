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
    print('PASS: signed install, real snapshot, scoped manifest, foreign host/app preserved')


if __name__ == '__main__':
    main()
