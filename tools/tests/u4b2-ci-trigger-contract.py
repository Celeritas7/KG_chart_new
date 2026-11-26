#!/usr/bin/env python3
"""F5: prevent accidental reintroduction of PR path filtering.

This is a deliberately narrow source-contract check, not a simulation of
GitHub's scheduler or an authorization test. Keep the event stanza simple:
all pull_request events of the default activity types, all branches/files,
plus explicit workflow_dispatch. No third-party YAML parser is required.
"""
from pathlib import Path
import re

WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/kg-u4b2-backend.yml"

def require_unfiltered_pr(source):
    # The top-level on stanza is intentionally canonical. Ignore comments
    # and blank lines; fail closed on filters, alternative triggers or gates.
    lines = [line.rstrip() for line in source.splitlines()
             if line.strip() and not line.lstrip().startswith("#")]
    starts = [i for i, line in enumerate(lines) if line == "on:"]
    if len(starts) != 1:
        raise AssertionError("Expected exactly one top-level on stanza")
    start = starts[0]
    end = next((i for i in range(start + 1, len(lines))
                if not lines[i][0].isspace()), len(lines))
    if lines[start:end] != ["on:", "  pull_request:", "  workflow_dispatch:"]:
        raise AssertionError("Database workflow must run for all PR paths and branches")
    # Require the isolated job itself to remain unconditional.
    jobs = [i for i, line in enumerate(lines) if line == "  isolated-database:"]
    if len(jobs) != 1:
        raise AssertionError("Missing isolated database job")
    start = jobs[0]
    end = next((i for i in range(start + 1, len(lines))
                if not lines[i].startswith("    ")), len(lines))
    if any(re.match(r"^    (if|needs):", line) for line in lines[start + 1:end]):
        raise AssertionError("Database job must not have a conditional/dependency skip gate")

def main():
    source = WORKFLOW.read_text(encoding="utf-8")
    require_unfiltered_pr(source)
    for mutant in (
        source.replace("  pull_request:\n", "  pull_request:\n    paths: ['sql/**']\n"),
        source.replace("  pull_request:\n", "  pull_request:\n    paths-ignore: ['tools/tests/**']\n"),
        source.replace("  pull_request:\n", "  pull_request:\n    branches: [main]\n"),
        source.replace("  pull_request:\n", "  pull_request:\n    types: [opened]\n"),
        source.replace("  isolated-database:\n", "  isolated-database:\n    if: false\n"),
        source.replace("  isolated-database:\n", "  isolated-database:\n    needs: another-job\n"),
    ):
        if mutant == source:
            raise AssertionError("Trigger mutation did not match source")
        try:
            require_unfiltered_pr(mutant)
        except AssertionError:
            continue
        raise AssertionError("A filtered or conditional trigger was accepted")
    print("U4B2_F5_UNFILTERED_PR_TRIGGER_CONTRACT_PASS: 6 negative source mutations")
    print("All paths include each race file, prerequisite SQL/fixtures, Edge tests and imported modules.")

if __name__ == "__main__":
    main()
