#!/usr/bin/env python3
"""Install this app and register its read-only native messaging bridge."""
import argparse
import json
import plistlib
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOST = 'jp.local.memoryharbor'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--app', type=Path, default=ROOT / 'dist/Memoriq.app')
    parser.add_argument('--destination', type=Path, default=Path.home() / 'Applications/Memoriq.app')
    parser.add_argument('--host-directory', type=Path,
                        default=Path.home() / 'Library/Application Support/Google/Chrome/NativeMessagingHosts')
    args = parser.parse_args()
    source, destination = args.app.expanduser().resolve(), args.destination.expanduser().resolve()
    with (source / 'Contents/Info.plist').open('rb') as handle:
        info = plistlib.load(handle)
    extension_id = info.get('MemoryHarborExtensionID', '')
    if info.get('CFBundleIdentifier') != HOST or not re.fullmatch('[a-p]{32}', extension_id):
        raise ValueError('Invalid application metadata')
    subprocess.run(['codesign', '--verify', '--strict', str(source)], check=True)
    host_dir = args.host_directory.expanduser().resolve()
    manifest_path = host_dir / f'{HOST}.json'
    if manifest_path.exists():
        old = json.loads(manifest_path.read_text())
        if old.get('name') != HOST:
            raise ValueError('Refusing to replace an unrelated native host')
    if source != destination:
        if destination.exists():
            with (destination / 'Contents/Info.plist').open('rb') as handle:
                previous = plistlib.load(handle)
            if previous.get('CFBundleIdentifier') != HOST:
                raise ValueError('Refusing to replace another app')
            shutil.rmtree(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source, destination, copy_function=shutil.copyfile)
        for name in ('MemoryHarbor',):
            (destination / 'Contents/MacOS' / name).chmod(0o755)
        subprocess.run(['xattr', '-cr', str(destination)], check=True)
        subprocess.run(['codesign', '--verify', '--strict', str(destination)], check=True)
    manifest = {
        'name': HOST, 'description': 'Memoriq read-only memory snapshot',
        'path': str(destination / 'Contents/MacOS/MemoryHarbor'),
        'type': 'stdio', 'allowed_origins': [f'chrome-extension://{extension_id}/'],
    }
    host_dir.mkdir(parents=True, exist_ok=True)
    temporary = manifest_path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(manifest_path)
    print(f'Installed: {destination}')
    print(f'Extension: {destination}/Contents/Resources/extension')
    print(f'Native host: {manifest_path}')


if __name__ == '__main__':
    main()
