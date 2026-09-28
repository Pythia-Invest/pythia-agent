"""Explicit bundled artifacts stay within their package and bounded byte budget."""
import os
import importlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from market_data_fixture import PLATFORM, platform_module

assets = importlib.import_module(PLATFORM + '.assets')


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

    def test_concurrent_file_edit_is_rejected_before_metadata_can_be_cached(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            file = root / 'view.mjs'
            file.write_text('before', encoding='utf-8')
            module = assets.BundledModule(root, 'view.mjs')
            read = os.read
            changed = False
            def edit_during_read(handle, count):
                nonlocal changed
                chunk = read(handle, count)
                if not changed:
                    changed = True
                    file.write_text('after!', encoding='utf-8')
                return chunk
            with patch.object(assets.os, 'read', side_effect=edit_during_read):
                with self.assertRaisesRegex(ValueError, 'changed during read'): module.read()
            self.assertEqual(module.read(include_content=True)[1], 'after!')
