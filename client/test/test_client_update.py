import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from client_update_package import install


class UpdatePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def package(self, extra=None, role='client'):
        source = self.root / 'update.zip'
        prefix = 'Journey-Desk-0.6.1-Windows-x64/'
        files = {name: b'test-only' for name in ('游戏启动器.exe', 'runtime/node.exe', 'resources/app/main.mjs',
            'resources/app/rendered/index.html', 'resources/dependencies/tools/python/python.exe',
            'resources/core/overfield-client.exe', 'resources/core/overfield-server.exe', 'resources/pcgame/PCGameSDK.dll', 'resources/offline/Lolo.exe', 'resources/offline/Lolo-source.zip')}
        files['resources/app/product.json'] = json.dumps(dict(role=role, version='0.6.1'))
        files.update(extra or {})
        with ZipFile(source, 'w') as archive:
            for name, data in files.items():
                archive.writestr(prefix + name, data)
        return source, hashlib.sha256(source.read_bytes()).hexdigest()

    def test_install_is_separate_and_an_existing_directory_cannot_be_overwritten(self):
        source, digest = self.package()
        target = self.root / 'new'
        result = install(source, target, '0.6.1', digest)
        self.assertEqual(result['version'], '0.6.1')
        self.assertTrue(Path(result['executable']).is_file())
        with self.assertRaises(ValueError):
            install(source, target, '0.6.1', digest)
        self.assertEqual((target / 'runtime/node.exe').read_bytes(), b'test-only')

    def test_hash_wrong_product_and_traversal_fail_before_installing(self):
        target = self.root / 'new'
        source, digest = self.package()
        with self.assertRaises(ValueError):
            install(source, target, '0.6.1', '0' * 64)
        for extra, role in [({'../outside': b'bad'}, 'client'), ({'CON.txt': b'bad'}, 'client'),
                            ({'RUNTIME/node.exe': b'case-alias'}, 'client'), ({}, 'server')]:
            source, digest = self.package(extra, role)
            with self.assertRaises(ValueError):
                install(source, target, '0.6.1', digest)
            self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
