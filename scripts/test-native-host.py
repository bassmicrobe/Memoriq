#!/usr/bin/env python3
"""Exercise the packaged native messaging executable with real framed input."""
import argparse
import json
import plistlib
import struct
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--app', type=Path, default=ROOT / 'dist/Memoriq.app')
    args = parser.parse_args()
    with (args.app / 'Contents/Info.plist').open('rb') as handle:
        info = plistlib.load(handle)
    host = args.app / 'Contents/MacOS/MemoryHarbor'
    origin = f"chrome-extension://{info['MemoryHarborExtensionID']}/"

    def run(payload, source=origin, framed=True):
        body = json.dumps(payload).encode() if not isinstance(payload, bytes) else payload
        stdin = struct.pack('<I', len(body)) + body if framed else body
        return subprocess.run([str(host), source], input=stdin, capture_output=True, timeout=15)

    def response(result):
        assert result.returncode == 0, result.stderr.decode()
        size = struct.unpack('<I', result.stdout[:4])[0]
        assert len(result.stdout) == size + 4
        return json.loads(result.stdout[4:])

    good = response(run({'version': 1, 'action': 'snapshot'}))
    assert good['ok'] is True and good['error'] is None
    assert good['data']['memory']['totalBytes'] > 0
    assert good['data']['memory']['pressure'] in ('normal', 'warning', 'critical', 'unknown')
    assert all(app['footprintBytes'] >= 0 for app in good['data']['apps'])
    for bad in ({'version': 1, 'action': 'quit'}, {'version': 2, 'action': 'snapshot'},
                {'version': True, 'action': 'snapshot'}, {'version': 1, 'action': 'snapshot', 'path': '/tmp'}, b'{'):
        denied = response(run(bad))
        assert denied['ok'] is False and denied['data'] is None and denied['error']
    wrong_origin = run({'version': 1, 'action': 'snapshot'}, source='chrome-extension://' + 'a' * 32 + '/')
    assert wrong_origin.returncode != 0 and not wrong_origin.stdout
    for malformed in (struct.pack('<I', 65537), struct.pack('<I', 0), b'\x01', struct.pack('<I', 8) + b'{}'):
        denied = run(malformed, framed=False)
        assert denied.returncode != 0 and not denied.stdout
    print('PASS: real snapshot, 5 invalid requests, origin rejection, 4 malformed frames')
    print(f"Live sample: {len(good['data']['apps'])} app groups; pressure={good['data']['memory']['pressure']}")


if __name__ == '__main__':
    main()
