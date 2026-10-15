"""Allocation-local entry point for the opt-in exploratory Si worker."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .artifact_storage import SQLiteArtifactIndex
from .artifacts import LocalArtifactStore
from .draft_storage import SQLiteDraftRepository
from .local_runtime import private_directory
from .projection_storage import SQLiteReadModels
from .storage import SQLiteRepository


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--site-config", type=Path, required=True)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--pseudo", type=Path, required=True)
    parser.add_argument("--wheelhouse", type=Path, required=True)
    args = parser.parse_args()
    state = private_directory(args.state_dir)
    repository = SQLiteRepository(state/"state.sqlite")
    artifacts = LocalArtifactStore(state/"artifacts", SQLiteArtifactIndex(repository))
    readmodels = SQLiteReadModels(repository)
    drafts = SQLiteDraftRepository(repository, artifacts)
    from .local_run import LocalRunApplication
    runtime = LocalRunApplication(
        state, repository, artifacts, readmodels, drafts,
        {"site_config": args.site_config, "profile": args.profile,
         "pseudo": args.pseudo, "wheelhouse": args.wheelhouse},
    )
    result = runtime._worker(args.run_id)
    print(json.dumps({"run_id": args.run_id, "native_status": result["native_status"],
                      "scientific_assessment": "NOT_ESTABLISHED"}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
