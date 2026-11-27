import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'client'))
sys.path.insert(0, str(ROOT / 'scripts'))
from client_update_delta import REQUIRED, digest, install_delta, manifest
from build_client_delta import build


class ClientDeltaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base, self.target = self.root / 'installed', self.root / 'new-release'
        self.make(self.base, '0.12.9')
        self.make(self.target, '0.12.10')
        (self.base / 'resources/removed.txt').write_text('old owned file')
        (self.target / 'resources/added.txt').write_text('new owned file')
        self.write_manifest(self.base, '0.12.9')
        self.write_manifest(self.target, '0.12.10')
        self.old_zip, self.new_zip = self.archive(self.base, '0.12.9'), self.archive(self.target, '0.12.10')
        self.delta = self.root / 'Journey-Desk-Delta-0.12.9-to-0.12.10-Windows-x64.zip'
        self.meta = build(self.old_zip, self.new_zip, self.delta)
        self.output = self.root / 'staged'

    def make(self, root, version):
        for name in REQUIRED:
            file = root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b'stable component bytes')
        (root / 'resources/app/main.mjs').write_text('changed-' + version)
        (root / 'resources/app/product.json').write_text(json.dumps(dict(role='client', version=version)))
        (root / 'resources/app/client-update.json').write_text(json.dumps(dict(repository='test/project', public_key='test-key')))

    def write_manifest(self, root, version):
        files = [dict(path=p.relative_to(root).as_posix(), bytes=p.stat().st_size, sha256=digest(p))
                 for p in sorted(root.rglob('*')) if p.is_file() and p.name != 'app-files.json']
        (root / 'app-files.json').write_text(json.dumps(dict(schema=1, kind='client_package', version=version, files=files)))

    def archive(self, root, version):
        path = self.root / f'Journey-Desk-{version}-Windows-x64.zip'
        with ZipFile(path, 'w') as archive:
            for file in root.rglob('*'):
                if file.is_file():
                    archive.write(file, f'Journey-Desk-{version}-Windows-x64/' + file.relative_to(root).as_posix())
        return path

    def install(self, **changes):
        values = dict(source=self.delta, output=self.output, version='0.12.10', expected_hash=digest(self.delta),
                      base=self.base, from_version='0.12.9', base_hash=self.meta['base_manifest_sha256'],
                      target_hash=self.meta['target_manifest_sha256'])
        values.update(changes)
        return install_delta(**values)

    def rewrite_patch(self, transform):
        with ZipFile(self.delta) as z:
            files = {name: z.read(name) for name in z.namelist()}
        transform(files)
        with ZipFile(self.delta, 'w') as z:
            for name, data in files.items():
                z.writestr(name, data)

    def test_reuses_stable_runtime_and_handles_added_and_removed_files_without_touching_base(self):
        before = {p.relative_to(self.base).as_posix(): p.read_bytes() for p in self.base.rglob('*') if p.is_file()}
        (self.base / 'my-private-account.zip').write_bytes(b'private user backup')
        result = self.install()
        self.assertGreater(result['reused_files'], 5)
        self.assertEqual(result['removed_files'], 1)
        self.assertFalse((self.output / 'resources/removed.txt').exists())
        self.assertFalse((self.output / 'my-private-account.zip').exists())
        for file in self.target.rglob('*'):
            if file.is_file():
                self.assertEqual(file.read_bytes(), (self.output / file.relative_to(self.target)).read_bytes())
        for name, content in before.items():
            self.assertEqual((self.base / name).read_bytes(), content)
        with ZipFile(self.delta) as z:
            self.assertFalse(any(n.endswith('/runtime/node.exe') for n in z.namelist()))
            self.assertFalse(any('private-account' in n for n in z.namelist()))

    def test_base_modification_hash_mismatch_and_overlapping_stage_are_rejected(self):
        with self.assertRaises(ValueError):
            self.install(expected_hash='0' * 64)
        with self.assertRaises(ValueError):
            self.install(base_hash='0' * 64)
        with self.assertRaises(ValueError):
            self.install(output=self.base / 'stage')
        (self.base / 'runtime/node.exe').write_bytes(b'changed locally')
        with self.assertRaises(ValueError):
            self.install()
        self.assertFalse(self.output.exists())

    def test_same_size_corruption_fails_target_inventory_and_never_changes_original(self):
        def corrupt(files):
            name = next(n for n in files if n.endswith('/resources/app/main.mjs'))
            files[name] = b'x' * len(files[name])
        self.rewrite_patch(corrupt)
        with self.assertRaises(ValueError):
            self.install()
        self.assertFalse(self.output.exists())
        self.assertEqual((self.base / 'resources/app/main.mjs').read_text(), 'changed-0.12.9')

    def test_missing_payload_and_traversal_are_rejected(self):
        original = self.delta.read_bytes()
        for transform in [lambda files: files.pop(next(n for n in files if n.endswith('/resources/app/main.mjs'))),
                          lambda files: files.update({'Journey-Desk-Delta-0.12.9-to-0.12.10-Windows-x64/../outside': b'bad'})]:
            self.delta.write_bytes(original)
            self.rewrite_patch(transform)
            with self.assertRaises(ValueError):
                self.install()
            self.assertFalse(self.output.exists())

    def test_wrong_target_inventory_and_existing_stage_are_rejected(self):
        with self.assertRaises(ValueError):
            self.install(target_hash='0' * 64)
        self.output.mkdir()
        (self.output / 'notes.txt').write_text('keep')
        with self.assertRaises(ValueError):
            self.install()
        self.assertEqual((self.output / 'notes.txt').read_text(), 'keep')

    def test_unsafe_inventory_paths_and_case_aliases_are_rejected(self):
        raw = json.loads((self.target / 'app-files.json').read_text())
        for name in ['resources/CON.txt', '../outside', 'resources/app/main.mjs/child']:
            bad = json.loads(json.dumps(raw))
            bad['files'].append(dict(path=name, bytes=1, sha256='0' * 64))
            with self.assertRaises(ValueError):
                manifest(json.dumps(bad).encode(), '0.12.10')
        bad = json.loads(json.dumps(raw))
        bad['files'].append({**bad['files'][0], 'path': bad['files'][0]['path'].upper()})
        with self.assertRaises(ValueError):
            manifest(json.dumps(bad).encode(), '0.12.10')

    def test_linked_base_member_is_never_reused(self):
        file = self.base / 'runtime/node.exe'
        outside = self.root / 'outside-runtime'
        shutil.copyfile(file, outside)
        file.unlink()
        try:
            file.symlink_to(outside)
        except OSError:
            self.skipTest('Windows symlink permission unavailable')
        with self.assertRaises(ValueError):
            self.install()
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
