"""Separate installed processor process; no engine handlers before Ola 3."""
import argparse
from pathlib import Path
import time

from .domain import Processor
from .launcher import _lease, _read, _owned
from .local_runtime import local_lock, private_directory
from .storage import SQLiteRepository


def run(state: Path, instance: str, once: bool = False):
    with local_lock(state / "processor.guard"):
        if not _owned(state, instance):
            raise ValueError("Processor is not owned by this local instance")
        processor = Processor(SQLiteRepository(state / "state.sqlite"))
        while _owned(state, instance):
            request = _read(state / f"stop-{instance}.json")
            if request is not None:
                break
            active = processor.once()
            if once:
                break
            if not active:
                time.sleep(0.1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    try:
        state = private_directory(args.state_dir)
        run(state, args.instance_id, args.once)
        return 0
    except Exception:
        # Never print raw exception values, request bodies or credentials.
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
