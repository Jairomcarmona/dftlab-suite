"""Immutable, verified installed assets; URL input never becomes a host path."""
import hashlib
import json
from importlib.resources import files
import re

from starlette.responses import Response


class WebAssets:
    def __init__(self):
        root = files("dftlab_platform").joinpath("resources/operative")
        manifest = json.loads(root.joinpath("manifest.json").read_text(encoding="utf-8"))
        if manifest.get("format") != "dftlab.operative-assets" or manifest.get("version") != 1:
            raise RuntimeError("Unsupported operative manifest")
        self.assets = {}
        for entry in manifest["files"]:
            name = entry["path"]
            if name in self.assets or not re.fullmatch(r"index\.html|assets/[A-Za-z0-9_-]+\.(js|css|wasm)", name):
                raise RuntimeError("Invalid operative asset name")
            data = root.joinpath(name).read_bytes()
            if len(data) != entry["size_bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
                raise RuntimeError("Operative asset integrity mismatch")
            self.assets[name] = data
        if "index.html" not in self.assets or manifest["entry"] not in self.assets:
            raise RuntimeError("Operative entry point missing")

    def response(self, name):
        from .domain import Problem
        if name not in self.assets:
            raise Problem("NOT_FOUND")
        mime = {"html": "text/html", "js": "text/javascript", "css": "text/css", "wasm": "application/wasm"}[name.rsplit(".", 1)[1]]
        return Response(self.assets[name], media_type=mime)


def mount_assets(app, base_path):
    assets = WebAssets()
    async def index():
        return assets.response("index.html")
    async def asset(asset_name: str):
        return assets.response("assets/" + asset_name)
    app.add_api_route(base_path + "/", index, methods=["GET"], include_in_schema=False)
    app.add_api_route(base_path + "/assets/{asset_name}", asset, methods=["GET"], include_in_schema=False)
