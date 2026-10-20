"""Reject release builds unless HEAD, the tag and completed checks name one commit."""
import argparse
from pathlib import Path
import re
import subprocess


def require_checked_commit(root, checked_sha, event_sha, tag):
    def revision(ref):
        return subprocess.check_output(
            ["git", "rev-parse", "--verify", ref + "^{commit}"],
            cwd=root, text=True, stderr=subprocess.PIPE,
        ).strip()

    if not re.fullmatch(r"[0-9a-f]{40}", checked_sha or ""):
        raise ValueError("Missing or invalid completed-check commit")
    if not re.fullmatch(r"[0-9a-f]{40}", event_sha or ""):
        raise ValueError("Missing or invalid event commit")
    if not re.fullmatch(r"v[0-9][0-9.]*", tag or ""):
        raise ValueError("Invalid release tag")
    head = revision("HEAD")
    if {head, checked_sha, event_sha, revision("refs/tags/" + tag)} != {head}:
        raise ValueError("Release checkout, tag and completed core checks must match")
    return head


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checked-sha", required=True)
    parser.add_argument("--event-sha", required=True)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()
    try:
        sha = require_checked_commit(Path(__file__).resolve().parents[1],
                                     args.checked_sha, args.event_sha, args.tag)
    except (ValueError, subprocess.CalledProcessError) as exc:
        raise SystemExit(str(exc))
    print("Release commit verified: " + sha)


if __name__ == "__main__":
    main()
