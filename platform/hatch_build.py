"""Package authoritative contracts verbatim, also when rebuilding the sdist."""
from pathlib import Path
import hashlib
import json
import re
from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        root = Path(self.root)
        source = root / "contracts"
        if not source.is_dir():
            source = root.parent / "contracts"
        if not (source / "schemas/envelope.schema.json").is_file():
            raise RuntimeError("Authoritative contracts missing; cannot build")
        destination = "dftlab_platform/resources/contracts" if self.target_name == "wheel" else "contracts"
        build_data.setdefault("force_include", {})[str(source)] = destination
        engine_lock = root / "engine-versions.lock.json"
        if not engine_lock.is_file():
            engine_lock = root.parent / "engine-versions.lock.json"
        if not engine_lock.is_file():
            raise RuntimeError("Pinned engine lock missing; cannot build")
        engine_destination = "dftlab_platform/resources/engine-versions.lock.json" if self.target_name == "wheel" else "engine-versions.lock.json"
        build_data["force_include"][str(engine_lock)] = engine_destination
        operative = root / "operative"
        if not operative.is_dir():
            operative = root.parent / "app/dist/operative"
        manifest_file = operative / "manifest.json"
        if not manifest_file.is_file():
            raise RuntimeError("Operative assets missing; run npm ci and npm run build in app/ first")
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        if manifest.get("format") != "dftlab.operative-assets" or manifest.get("version") != 1:
            raise RuntimeError("Unsupported operative manifest")
        prefix = "dftlab_platform/resources/operative" if self.target_name == "wheel" else "operative"
        included = build_data["force_include"]
        included[str(manifest_file)] = prefix + "/manifest.json"
        seen = set()
        for entry in manifest["files"]:
            name = entry["path"]
            if name in seen or not re.fullmatch(r"index\.html|assets/[A-Za-z0-9_-]+\.(js|css|wasm)", name):
                raise RuntimeError("Invalid operative asset name")
            seen.add(name)
            file = operative / name
            if file.is_symlink():
                raise RuntimeError("Operative asset must not be a link")
            data = file.read_bytes()
            if len(data) != entry["size_bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
                raise RuntimeError("Operative asset digest mismatch")
            included[str(file)] = prefix + "/" + name
        if "index.html" not in seen or manifest["entry"] not in seen:
            raise RuntimeError("Operative entry point missing")
