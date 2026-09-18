"""Explicit bundled artifacts stay within their package and bounded byte budget."""
import os
from pathlib import Path
import tempfile
import unittest

from test_market_data_identity import platform_module


class BundledAssets(unittest.TestCase):
    def test_regular_utf8_artifact_and_admission_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            assets = root / 'widgets'
            assets.mkdir()
            file = assets / 'demo.html'
            file.write_text('<p>Demo</p>', encoding='utf-8')
            read = platform_module.read_bundled_asset
            self.assertEqual(read(root, 'widgets/demo.html'), '<p>Demo</p>')
            for path in ('../demo.html', '/demo.html', 'widgets/./demo.html', 'widgets//demo.html'):
                with self.subTest(path=path), self.assertRaises(ValueError): read(root, path)
            with self.assertRaises(ValueError): read(root, 'widgets/demo.html', max_bytes=3)
            file.write_bytes(b'\xff')
            with self.assertRaises(UnicodeDecodeError): read(root, 'widgets/demo.html')

    def test_links_cannot_expand_package_authority(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'real').mkdir()
            (root / 'real' / 'demo.html').write_text('demo', encoding='utf-8')
            (root / 'alias').symlink_to(root / 'real', target_is_directory=True)
            (root / 'linked.html').symlink_to(root / 'real' / 'demo.html')
            os.link(root / 'real' / 'demo.html', root / 'hard.html')
            for path in ('alias/demo.html', 'linked.html', 'hard.html', 'real/demo.html'):
                with self.subTest(path=path), self.assertRaises((ValueError, OSError)):
                    platform_module.read_bundled_asset(root, path)
