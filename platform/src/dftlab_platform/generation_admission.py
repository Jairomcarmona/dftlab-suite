"""Reference evaluator for ADR-017 Addendum 12 generation admission."""


def evaluate_generation_admission(max_attempts, case):
    """Return the first L.5 admission verdict for one supplied state snapshot."""
    generations = case["generations"]
    dispatches = case["dispatches"]
    request = case["request"]
    generation = request["generation"]
    top = max((entry["generation"] for entry in generations), default=0)
    latest = next((entry for entry in generations if entry["generation"] == top), None)

    def phase_of(number):
        return next((entry["phase"] for entry in dispatches if entry["generation"] == number), None)

    def admit(reason):
        return {"decision": "ADMIT", "reason": reason}

    def refuse(reason):
        return {"decision": "REFUSE", "reason": reason}

    kind = request["kind"]
    if kind == "AUTHORITY_CHECK":
        if generation > top:
            return refuse("UNKNOWN_GENERATION")
        return refuse("SUPERSEDED") if generation < top else admit("CURRENT_GENERATION")
    if kind == "AUTHORITY_CREATE":
        if phase_of(generation) in (None, "RESERVED"):
            return refuse("DISPATCH_NOT_STARTED")
        if generation != top + 1:
            return refuse("GENERATION_NOT_NEXT")
        if latest is not None and not latest["retired"]:
            return refuse("PREVIOUS_GENERATION_ACTIVE")
        return admit("NEXT_GENERATION")
    if generation == 1:
        return refuse("RUN_ALREADY_SUBMITTED") if top > 0 or phase_of(1) is not None else admit("NEXT_GENERATION")
    if generation != top + 1:
        return refuse("GENERATION_NOT_NEXT")
    if generation > max_attempts:
        return refuse("ATTEMPTS_EXHAUSTED")
    if not latest["retired"]:
        return refuse("PREVIOUS_GENERATION_ACTIVE")
    proof = latest["proof"]
    if not proof or not proof["sacct_terminal"] or proof["owner_proof"] not in {
        "CLOSED", "OWNER_DEAD_BY_BOOT_CHANGE",
    }:
        return refuse("PREVIOUS_TERMINATION_NOT_PROVEN")
    if phase_of(top) != "ACKNOWLEDGED":
        return refuse("PREVIOUS_DISPATCH_UNRESOLVED")
    plan = case["resume_plan"]
    if plan is None or plan["from_attempt_id"] != latest["attempt_id"]:
        return refuse("RESUME_PLAN_STALE")
    if latest["verdict"] == "REFUSE" and plan["plan_revision"] <= latest["plan_revision"]:
        return refuse("RESUME_REFUSED_PLAN_UNCHANGED")
    return admit("NEXT_GENERATION")
