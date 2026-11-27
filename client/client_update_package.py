"""Verify a signed-release package's digest and install into a new directory."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tempfile
from zipfile import ZipFile


def install(source, output, version, expected_hash):
    source, output = Path(source), Path(output).absolute()
    if not re.fullmatch(r'\d{1,5}\.\d{1,5}\.\d{1,5}', version) or not re.fullmatch('[a-f0-9]{64}', expected_hash):
        raise ValueError('Invalid release metadata')
    if output.exists() or output.is_symlink() or not output.parent.is_dir():
        raise ValueError('Installation requires a new directory')
    digest = hashlib.sha256()
    with source.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b''):
            digest.update(chunk)
    if digest.hexdigest() != expected_hash:
        raise ValueError('Release digest mismatch')
    prefix = f'Journey-Desk-{version}-Windows-x64/'
    with ZipFile(source) as archive:
        files, seen, total = [], set(), 0
        entries = archive.infolist()
        if len(entries) > 50000:
            raise ValueError('Too many release files')
        for info in entries:
            if not info.orig_filename.startswith(prefix):
                raise ValueError('Unexpected release root')
            relative = info.orig_filename[len(prefix):].rstrip('/')
            if not relative:
                if info.is_dir():
                    continue
                raise ValueError('Invalid release member')
            path = PurePosixPath(relative)
            if path.is_absolute() or re.search(r'[\\:\x00-\x1f<>"|?*]', relative) or any(
                part in ('', '.', '..') or part.endswith((' ', '.')) or
                re.fullmatch(r'(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', part)
                for part in relative.split('/')):
                raise ValueError('Invalid release path')
            key = relative.casefold()
            if key in seen or info.flag_bits & 1 or (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Duplicate, encrypted, or linked release member')
            seen.add(key)
            total += info.file_size
            if total > 1 << 30 or info.file_size > 256 << 20:
                raise ValueError('Release expansion exceeds budget')
            if not info.is_dir():
                files.append((relative, info))
        required = {'游戏启动器.exe', 'runtime/node.exe', 'resources/app/product.json',
            'resources/app/main.mjs', 'resources/app/rendered/index.html',
            'resources/dependencies/tools/python/python.exe', 'resources/core/overfield-client.exe', 'resources/core/overfield-server.exe', 'resources/pcgame/PCGameSDK.dll', 'resources/offline/Lolo.exe', 'resources/offline/Lolo-source.zip'}
        if not required <= {name for name, _ in files}:
            raise ValueError('Incomplete release package')
        product = json.loads(archive.read(prefix + 'resources/app/product.json'))
        if product.get('role') != 'client' or product.get('version') != version:
            raise ValueError('Wrong product or version')
        with tempfile.TemporaryDirectory(dir=output.parent, prefix='.client-install-') as directory:
            stage = Path(directory) / 'product'
            stage.mkdir()
            for name, info in files:
                target = stage / name
                target.parent.mkdir(parents=True, exist_ok=True)
                # Stream through ZipExtFile to enforce CRC without loading it all.
                with archive.open(info) as stream, target.open('xb') as sink:
                    for chunk in iter(lambda: stream.read(1 << 20), b''):
                        sink.write(chunk)
            stage.replace(output)
    return dict(path=str(output), executable=str(output / '游戏启动器.exe'), version=version)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--version', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--base-installation', type=Path)
    parser.add_argument('--from-version')
    parser.add_argument('--base-manifest-sha256')
    parser.add_argument('--target-manifest-sha256')
    args = parser.parse_args()
    try:
        if args.base_installation:
            # Embedded Windows Python uses a fixed ._pth and does not add the
            # script directory automatically. Load only this bundled sibling.
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            from client_update_delta import install_delta
            result = install_delta(args.input, args.output, args.version, args.sha256,
                args.base_installation, args.from_version, args.base_manifest_sha256, args.target_manifest_sha256)
        else:
            result = install(args.input, args.output, args.version, args.sha256)
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps(dict(code='invalid_update', message=str(error))), file=sys.stderr)
        raise SystemExit(1)
