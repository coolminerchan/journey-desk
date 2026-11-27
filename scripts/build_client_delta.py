"""Build a file delta between two verified client release ZIPs. No extraction."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'client'))
from client_update_delta import manifest, digest


def inventory(archive):
    names = [name for name in archive.namelist() if not name.endswith('/')]
    roots = {name.split('/')[0] for name in names}
    if len(roots) != 1 or len(names) != len({name.casefold() for name in names}):
        raise ValueError('Invalid release archive roots or duplicate entries')
    prefix = next(iter(roots)) + '/'
    product = json.loads(archive.read(prefix + 'resources/app/product.json'))
    version = product.get('version')
    if product.get('role') != 'client' or prefix != f'Journey-Desk-{version}-Windows-x64/':
        raise ValueError('Invalid client release archive')
    raw = archive.read(prefix + 'app-files.json')
    rows = manifest(raw, version)
    if set(names) != {prefix + 'app-files.json', *(prefix + name for name in rows)}:
        raise ValueError('Archive does not match complete release inventory')
    for name, row in rows.items():
        item = archive.getinfo(prefix + name)
        if item.file_size != row['bytes'] or item.flag_bits & 1 or (item.external_attr >> 16) & 0o170000 == 0o120000:
            raise ValueError('Invalid release member')
        result = hashlib.sha256()
        with archive.open(item) as stream:
            for chunk in iter(lambda: stream.read(1 << 20), b''):
                result.update(chunk)
        if result.hexdigest() != row['sha256']:
            raise ValueError('Release inventory hash mismatch: ' + name)
    return prefix, version, raw, rows


def build(base, target, output):
    output = Path(output)
    if output.exists() or output.with_suffix(output.suffix + '.json').exists():
        raise ValueError('Refusing to overwrite an existing release artifact')
    with ZipFile(base) as old, ZipFile(target) as new:
        old_prefix, previous, old_raw, before = inventory(old)
        new_prefix, version, raw, after = inventory(new)
        if tuple(map(int, previous.split('.'))) >= tuple(map(int, version.split('.'))):
            raise ValueError('Delta target must be newer')
        if old.read(old_prefix + 'resources/app/client-update.json') != new.read(new_prefix + 'resources/app/client-update.json'):
            raise ValueError('Delta publisher trust changed')
        changed = sorted(name for name, row in after.items() if before.get(name) != row)
        removed = sorted(before.keys() - after.keys())
        metadata = dict(schema=1, kind='client_delta', from_version=previous, version=version,
                        base_manifest_sha256=hashlib.sha256(old_raw).hexdigest(),
                        target_manifest_sha256=hashlib.sha256(raw).hexdigest(), changed=changed, removed=removed)
        prefix = f'Journey-Desk-Delta-{previous}-to-{version}-Windows-x64/'
        expected_name = prefix[:-1] + '.zip'
        if output.name != expected_name:
            raise ValueError('Delta filename does not match release versions')
        output.parent.mkdir(parents=True, exist_ok=True)
        try:
            with ZipFile(output, 'x', ZIP_DEFLATED, compresslevel=9) as archive:
                def put(name, data):
                    info = ZipInfo(prefix + name, (2026, 1, 1, 0, 0, 0))
                    info.compress_type = ZIP_DEFLATED
                    archive.writestr(info, data)
                put('delta.json', json.dumps(metadata, ensure_ascii=False, separators=(',', ':')).encode())
                put('app-files.json', raw)
                for name in changed:
                    put(name, new.read(new_prefix + name))
        except BaseException:
            output.unlink(missing_ok=True)
            raise
    descriptor = {key: metadata[key] for key in ('from_version', 'version', 'base_manifest_sha256', 'target_manifest_sha256')}
    descriptor.update(file=output.name, bytes=output.stat().st_size, sha256=digest(output),
                      changed_files=len(changed), reused_files=len(after) - len(changed), removed_files=len(removed))
    output.with_suffix(output.suffix + '.json').write_text(json.dumps(descriptor, indent=2) + '\n', encoding='utf-8')
    return descriptor


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True, type=Path)
    parser.add_argument('--target', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.base, args.target, args.output)))
