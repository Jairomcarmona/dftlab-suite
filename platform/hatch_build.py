"""Package authoritative contracts verbatim, also when rebuilding the sdist."""
from pathlib import Path
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
