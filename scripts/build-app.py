#!/usr/bin/env python3
"""Build a local, ad-hoc signed macOS app without external dependencies."""
import argparse
import plistlib
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'dist' / 'Memoriq.app')
    args = parser.parse_args()
    extension_id = (ROOT / 'extension/extension-id.txt').read_text().strip()
    if not re.fullmatch('[a-p]{32}', extension_id):
        raise ValueError('Invalid extension ID')
    output = args.output.expanduser().resolve()
    if output.exists() and not (output / 'Contents/Info.plist').exists():
        raise ValueError('Refusing to replace a path that is not an app bundle')
    with tempfile.TemporaryDirectory(prefix='memoryharbor-build-') as temporary:
        scratch = Path(temporary) / 'swift'
        subprocess.run(['swift', 'build', '-c', 'release', '--scratch-path', str(scratch)], cwd=ROOT, check=True)
        bin_path = subprocess.check_output(
            ['swift', 'build', '-c', 'release', '--scratch-path', str(scratch), '--show-bin-path'],
            cwd=ROOT, text=True).strip()
        staged = Path(temporary) / 'Memoriq.app'
        macos = staged / 'Contents/MacOS'
        resources = staged / 'Contents/Resources'
        macos.mkdir(parents=True)
        resources.mkdir(parents=True)
        shutil.copyfile(Path(bin_path) / 'MemoryHarbor', macos / 'MemoryHarbor')
        (macos / 'MemoryHarbor').chmod(0o755)
        shutil.copytree(ROOT / 'extension', resources / 'extension',
                        ignore=shutil.ignore_patterns('tests', 'test-results'))
        shutil.copyfile(ROOT / 'README.md', resources / 'README.md')
        shutil.copytree(ROOT / 'docs', resources / 'docs', copy_function=shutil.copyfile)
        info = {
            'CFBundleName': 'Memoriq', 'CFBundleDisplayName': 'Memoriq',
            'CFBundleIdentifier': 'jp.local.memoryharbor', 'CFBundleExecutable': 'MemoryHarbor',
            'CFBundlePackageType': 'APPL', 'CFBundleVersion': '1',
            'CFBundleShortVersionString': '0.1.0', 'LSMinimumSystemVersion': '13.0',
            'LSUIElement': True, 'NSHighResolutionCapable': True,
            'MemoryHarborExtensionID': extension_id,
        }
        with (staged / 'Contents/Info.plist').open('wb') as handle:
            plistlib.dump(info, handle)
        subprocess.run(['xattr', '-cr', str(staged)], check=True)
        subprocess.run(['codesign', '--force', '--sign', '-', str(staged)], check=True)
        if output.exists():
            with (output / 'Contents/Info.plist').open('rb') as handle:
                existing = plistlib.load(handle)
            if existing.get('CFBundleIdentifier') != 'jp.local.memoryharbor':
                raise ValueError('Refusing to replace another application')
            shutil.rmtree(output)
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(staged, output, copy_function=shutil.copyfile)
        (output / 'Contents/MacOS/MemoryHarbor').chmod(0o755)
        subprocess.run(['xattr', '-cr', str(output)], check=True)
        subprocess.run(['codesign', '--verify', '--strict', str(output)], check=True)
    print(output)


if __name__ == '__main__':
    main()
