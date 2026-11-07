#!/usr/bin/env python3
"""Preview or publish this starter using the authenticated GitHub CLI."""

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
SEEDS = [
    ("Agree on MVP and assign five team roles", "planning", "Complete docs/MVP.md and docs/TEAM.md. Confirm event requirements and assign one owner per workstream."),
    ("Select stack and document clean setup", "setup", "Choose the stack, commit its lockfile, add application CI, and verify the README commands on a teammate's machine."),
    ("Agree on API and data contract", "backend", "Record request/response examples, sample data, validation, errors, and ownership in docs/ARCHITECTURE.md."),
    ("Build the core end-to-end demo journey", "feature", "Implement the single MVP journey, including loading, empty, and failure states. Have another teammate verify it."),
    ("Deploy and verify shared demo URL", "deployment", "Record hosting settings and recovery steps. Confirm everyone can access the deployed journey."),
    ("Rehearse demo and complete submission", "demo", "Complete docs/DEMO.md, record a backup demo, check every submission link, and tag the tested commit."),
]
COLORS = {"planning": "7057ff", "setup": "0075ca", "backend": "1d76db", "feature": "a2eeef", "deployment": "0e8a16", "demo": "d876e3"}


def run(*args, capture=True):
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=capture)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or "Command failed").strip())
    return result.stdout.strip() if capture else ""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", help="OWNER/REPO; creates a private repository by default")
    parser.add_argument("--collaborator", action="append", default=[], help="GitHub username; repeat for teammates")
    parser.add_argument("--public", action="store_true", help="Explicitly publish publicly")
    parser.add_argument("--apply", action="store_true", help="Execute; otherwise only print the plan")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+", args.repo):
        parser.error("Use OWNER/REPO with no URL, spaces, or shell syntax.")
    people = list(dict.fromkeys(args.collaborator))
    if len(people) > 4:
        parser.error("This starter expects at most four collaborators plus the owner.")
    for person in people:
        if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?", person):
            parser.error("Collaborators must be GitHub usernames, not email addresses.")
    visibility = "public" if args.public else "private"
    print(f"Repository: {args.repo} ({visibility} for initial creation)")
    print("Plan: publish initial commit if needed, configure six labels, seed six issues.")
    print("Invite with write access: " + (", ".join(people) or "none supplied"))
    if len(people) < 4:
        print(f"Still missing {4 - len(people)} collaborator username(s). Rerun to add them later.")
    if not args.apply:
        print("Preview only. Add --apply to execute this plan.")
        return

    run("gh", "auth", "status")
    if run("git", "rev-parse", "--show-toplevel") != str(ROOT):
        raise RuntimeError("Run git init in this starter directory before publishing.")
    if run("git", "status", "--porcelain"):
        raise RuntimeError("Commit or resolve local changes before publishing.")
    run("git", "rev-parse", "--verify", "HEAD")
    # Validate recipients before creating anything. The owner is not a collaborator.
    owner = args.repo.split("/")[0]
    for person in people:
        if person.lower() == owner.lower():
            raise RuntimeError("The repository owner must not also be a collaborator.")
        run("gh", "api", f"users/{person}", "--jq", ".login")

    remotes = run("git", "remote").splitlines()
    if "origin" in remotes:
        origin = run("git", "remote", "get-url", "origin")
        allowed = {f"https://github.com/{args.repo}", f"https://github.com/{args.repo}.git", f"git@github.com:{args.repo}.git"}
        if origin.lower() not in {url.lower() for url in allowed}:
            raise RuntimeError("Existing origin does not match the requested repository; refusing to change it.")
        run("gh", "repo", "view", args.repo, "--json", "nameWithOwner")
        print("Matching origin found; skipping creation and push.")
    else:
        exists = subprocess.run(["gh", "repo", "view", args.repo, "--json", "nameWithOwner"], cwd=ROOT, capture_output=True)
        if exists.returncode == 0:
            raise RuntimeError("That repository already exists. Clone it separately rather than overwriting it.")
        run("gh", "repo", "create", args.repo, f"--{visibility}", "--source", str(ROOT), "--remote", "origin", "--push", "--description", "UTD Hackathon 26 team workspace", capture=False)

    run("gh", "repo", "edit", args.repo, "--enable-issues", "--enable-wiki=false")
    for label, color in COLORS.items():
        run("gh", "label", "create", label, "--repo", args.repo, "--color", color, "--force")
    existing = json.loads(run("gh", "api", f"repos/{args.repo}/issues?state=all&per_page=100", "--paginate", "--slurp"))
    titles = {issue["title"] for page in existing for issue in page if "pull_request" not in issue}
    for title, label, body in SEEDS:
        if title not in titles:
            run("gh", "issue", "create", "--repo", args.repo, "--title", title, "--label", label, "--body", body)
    # Existing collaborators and pending invitations are skipped on retries.
    members = json.loads(run("gh", "api", f"repos/{args.repo}/collaborators?per_page=100", "--paginate", "--slurp"))
    pending = json.loads(run("gh", "api", f"repos/{args.repo}/invitations?per_page=100", "--paginate", "--slurp"))
    known = {item["login"].lower() for page in members for item in page}
    known.update(item["invitee"]["login"].lower() for page in pending for item in page if item.get("invitee"))
    for person in people:
        if person.lower() not in known:
            run("gh", "api", "--method", "PUT", f"repos/{args.repo}/collaborators/{person}", "-f", "permission=push")
            print(f"Invitation requested: {person}; acceptance may still be required.")
        else:
            print(f"Already a collaborator or invited: {person}")
    print(f"Ready: https://github.com/{args.repo}")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError) as exc:
        print(f"Stopped: {exc}", file=sys.stderr)
        print("Some remote steps may already have completed. Resolve the error and rerun the same command.", file=sys.stderr)
        sys.exit(1)
