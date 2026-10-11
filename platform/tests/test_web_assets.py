import hashlib
import json
from importlib.resources import files
import unittest

from dftlab_platform.domain import Problem
from dftlab_platform.web_assets import WebAssets


class InstalledAssets(unittest.TestCase):
    def test_manifest_allowlist_hashes_and_no_host_path_resolution(self):
        assets = WebAssets()
        root = files("dftlab_platform").joinpath("resources/operative")
        manifest = json.loads(root.joinpath("manifest.json").read_text())
        self.assertEqual(manifest["api_version"], "0.1.0")
        self.assertGreater(len(assets.assets), 20)
        self.assertEqual(set(assets.assets), {entry["path"] for entry in manifest["files"]})
        for entry in manifest["files"]:
            self.assertEqual(hashlib.sha256(assets.response(entry["path"]).body).hexdigest(), entry["sha256"])
        for path in ("../state.sqlite", "manifest.json", "assets/../../../access.json", "assets/stale.js", "assets/%2e%2e"):
            with self.assertRaises(Problem):
                assets.response(path)
