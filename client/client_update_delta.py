"""Reconstruct a signed delta into a separate, fully verified client package."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import tempfile
from zipfile import ZipFile

VERSION = re.compile(r'\d{1,5}\.\d{1,5}\.\d{1,5}')
HASH = re.compile(r'[a-f0-9]{64}')
ROOTS = {'游戏启动器.exe', 'runtime', 'resources', 'licenses', 'docs', 'app-files.json',
         '使用说明.md', '致谢.txt', 'README.md', 'Release-notes.md', '单机游玩.md', '统一联机.md', '连接恢复.md'}
REQUIRED = {'游戏启动器.exe', 'runtime/node.exe', 'resources/app/product.json', 'resources/app/main.mjs',
            'resources/app/client-update.json', 'resources/app/rendered/index.html',
            'resources/dependencies/tools/python/python.exe', 'resources/core/overfield-client.exe',
            'resources/core/overfield-server.exe', 'resources/pcgame/PCGameSDK.dll',
            'resources/offline/Lolo.exe', 'resources/offline/Lolo-source.zip'}


def digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b''):
            result.update(chunk)
    return result.hexdigest()


def valid_path(value):
    return (isinstance(value, str) and 0 < len(value) <= 1024
            and not re.search(r'[\\:\x00-\x1f<>"|?*]', value)
            and value.split('/')[0] in ROOTS and all(
                part not in ('', '.', '..') and not part.endswith((' ', '.')) and not
                re.fullmatch(r'(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', part)
                for part in value.split('/')))


def manifest(raw, version):
    if len(raw) > 4 << 20:
        raise ValueError('Package inventory exceeds limit')
    info = json.loads(raw)
    if (info.get('schema') != 1 or info.get('kind') != 'client_package' or info.get('version') != version
            or not isinstance(info.get('files'), list) or len(info['files']) > 50000):
        raise ValueError('Invalid package inventory')
    rows, seen, total = {}, set(), 0
    for row in info['files']:
        name = row.get('path')
        if (not valid_path(name) or name == 'app-files.json' or name.casefold() in seen
                or type(row.get('bytes')) is not int or not 0 <= row['bytes'] <= 256 << 20
                or not isinstance(row.get('sha256'), str) or not HASH.fullmatch(row['sha256'])):
            raise ValueError('Invalid package inventory entry')
        rows[name] = row
        seen.add(name.casefold())
        total += row['bytes']
    if total > 1 << 30 or not REQUIRED <= rows.keys():
        raise ValueError('Incomplete or oversized package inventory')
    for name in seen:
        parts = name.split('/')
        if any('/'.join(parts[:n]) in seen for n in range(1, len(parts))):
            raise ValueError('Conflicting inventory paths')
    return rows


def safe_file(root, name):
    if not valid_path(name):
        raise ValueError('Invalid package path')
    current = Path(root)
    for part in name.split('/'):
        current /= part
        metadata = current.lstat()
        if stat.S_ISLNK(metadata.st_mode) or getattr(metadata, 'st_file_attributes', 0) & 0x400:
            raise ValueError('Redirected installed file or directory')
    if not stat.S_ISREG(current.lstat().st_mode):
        raise ValueError('Installed package member is not a file')
    return current


def verify_file(path, row):
    if path.stat().st_size != row['bytes'] or digest(path) != row['sha256']:
        raise ValueError('Installed base or reconstructed file changed: ' + row['path'])


def install_delta(source, output, version, expected_hash, base, from_version, base_hash, target_hash):
    if (not all(isinstance(v, str) and VERSION.fullmatch(v) for v in (version, from_version))
            or not all(isinstance(v, str) and HASH.fullmatch(v) for v in (expected_hash, base_hash, target_hash))):
        raise ValueError('Invalid delta release metadata')
    base, output = Path(base).absolute(), Path(output).absolute()
    if (base.resolve() != base or not base.is_dir() or output.exists() or output.is_symlink()
            or not output.parent.is_dir() or output.resolve().is_relative_to(base.resolve())
            or base.resolve().is_relative_to(output.resolve())):
        raise ValueError('Delta staging requires separate, unredirected directories')
    if digest(source) != expected_hash:
        raise ValueError('Delta archive digest mismatch')
    base_raw = safe_file(base, 'app-files.json').read_bytes()
    if hashlib.sha256(base_raw).hexdigest() != base_hash:
        raise ValueError('Delta base inventory mismatch')
    before = manifest(base_raw, from_version)
    for row in before.values():
        verify_file(safe_file(base, row['path']), row)
    product = json.loads(safe_file(base, 'resources/app/product.json').read_bytes())
    if product.get('role') != 'client' or product.get('version') != from_version:
        raise ValueError('Delta base product mismatch')
    prefix = f'Journey-Desk-Delta-{from_version}-to-{version}-Windows-x64/'
    with ZipFile(source) as archive:
        members, folded, total = {}, set(), 0
        for info in archive.infolist():
            name = info.orig_filename
            if (not name.startswith(prefix) or info.is_dir() or info.flag_bits & 1
                    or (info.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError('Invalid delta archive member')
            relative = name[len(prefix):]
            if relative != 'delta.json' and not valid_path(relative):
                raise ValueError('Invalid delta archive path')
            if relative.casefold() in folded or len(members) >= 50002 or info.file_size > 256 << 20:
                raise ValueError('Duplicate or oversized delta member')
            total += info.file_size
            if total > 1 << 30:
                raise ValueError('Delta archive expansion exceeds limit')
            folded.add(relative.casefold())
            members[relative] = info
        if not {'delta.json', 'app-files.json'} <= members.keys():
            raise ValueError('Missing delta metadata')
        if members['delta.json'].file_size > 4 << 20 or members['app-files.json'].file_size > 4 << 20:
            raise ValueError('Oversized delta metadata')
        delta = json.loads(archive.read(members['delta.json']))
        expected = dict(schema=1, kind='client_delta', from_version=from_version, version=version,
                        base_manifest_sha256=base_hash, target_manifest_sha256=target_hash)
        if any(delta.get(key) != value for key, value in expected.items()):
            raise ValueError('Delta metadata does not match signed release')
        raw = archive.read(members['app-files.json'])
        if hashlib.sha256(raw).hexdigest() != target_hash:
            raise ValueError('Delta target inventory mismatch')
        after = manifest(raw, version)
        changed = sorted(name for name, row in after.items() if before.get(name) != row)
        removed = sorted(before.keys() - after.keys())
        if (delta.get('changed') != changed or delta.get('removed') != removed
                or set(members) != {'delta.json', 'app-files.json', *changed}):
            raise ValueError('Incomplete or unexpected delta payload')
        with tempfile.TemporaryDirectory(dir=output.parent, prefix='.client-delta-') as directory:
            stage = Path(directory) / 'product'
            stage.mkdir()
            (stage / 'app-files.json').write_bytes(raw)
            for name, row in after.items():
                destination = stage / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                if name in members:
                    if members[name].file_size != row['bytes']:
                        raise ValueError('Delta payload size mismatch')
                    with archive.open(members[name]) as incoming, destination.open('xb') as outgoing:
                        shutil.copyfileobj(incoming, outgoing, 1 << 20)
                else:
                    shutil.copyfile(safe_file(base, name), destination)
                verify_file(destination, row)
            new_product = json.loads((stage / 'resources/app/product.json').read_bytes())
            trust = json.loads((stage / 'resources/app/client-update.json').read_bytes())
            previous_trust = json.loads(safe_file(base, 'resources/app/client-update.json').read_bytes())
            if (new_product.get('role') != 'client' or new_product.get('version') != version
                    or trust.get('repository') != previous_trust.get('repository')
                    or trust.get('public_key', '').strip() != previous_trust.get('public_key', '').strip()):
                raise ValueError('Delta product or publisher mismatch')
            stage.replace(output)
    return dict(path=str(output), executable=str(output / '游戏启动器.exe'), version=version,
                kind='delta', changed_files=len(changed), reused_files=len(after) - len(changed), removed_files=len(removed))
