#!/usr/bin/env python3
"""Create GitHub labels, milestones, and issues from a JSON backlog seed.

Dry-run by default. Pass --apply to mutate GitHub.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


DEFAULT_SEED = Path("docs/project-management/github-backlog-seed.json")


def run(command: list[str], apply: bool) -> subprocess.CompletedProcess[str] | None:
    printable = " ".join(command)
    if not apply:
        print(f"DRY RUN: {printable}")
        return None

    result = subprocess.run(command, text=True, capture_output=True)
    if result.returncode != 0:
        print(result.stderr.strip(), file=sys.stderr)
    return result


def gh_json(command: list[str]) -> object:
    result = subprocess.run(command, text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout)


def existing_labels(repo: str) -> set[str]:
    labels: set[str] = set()
    page = 1
    while True:
        data = gh_json([
            "gh",
            "api",
            "-X",
            "GET",
            f"repos/{repo}/labels",
            "-f",
            "per_page=100",
            "-f",
            f"page={page}",
        ])
        if not isinstance(data, list) or not data:
            return labels
        labels.update(str(item["name"]) for item in data)
        page += 1


def existing_milestones(repo: str) -> set[str]:
    data = gh_json([
        "gh",
        "api",
        "-X",
        "GET",
        f"repos/{repo}/milestones",
        "-f",
        "state=all",
        "-f",
        "per_page=100",
    ])
    if not isinstance(data, list):
        return set()
    return {str(item["title"]) for item in data}


def existing_issue_titles(repo: str) -> set[str]:
    data = gh_json([
        "gh",
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "all",
        "--limit",
        "1000",
        "--json",
        "title",
    ])
    if not isinstance(data, list):
        return set()
    return {str(item["title"]) for item in data}


def create_label(repo: str, label: dict[str, str], apply: bool) -> None:
    command = [
        "gh",
        "label",
        "create",
        label["name"],
        "--repo",
        repo,
        "--color",
        label["color"],
        "--description",
        label["description"],
    ]
    run(command, apply)


def create_milestone(repo: str, milestone: dict[str, str], apply: bool) -> None:
    command = [
        "gh",
        "api",
        f"repos/{repo}/milestones",
        "-f",
        f"title={milestone['title']}",
        "-f",
        f"description={milestone['description']}",
    ]
    run(command, apply)


def create_issue(repo: str, issue: dict[str, object], project: str | None, apply: bool) -> None:
    body = f"Backlog ID: {issue['id']}\n\n{issue['body']}"
    command = [
        "gh",
        "issue",
        "create",
        "--repo",
        repo,
        "--title",
        str(issue["title"]),
        "--body",
        body,
        "--milestone",
        str(issue["milestone"]),
    ]
    for label in issue["labels"]:
        command.extend(["--label", str(label)])
    if project:
        command.extend(["--project", project])
    run(command, apply)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=Path, default=DEFAULT_SEED)
    parser.add_argument("--apply", action="store_true", help="Create labels, milestones, and issues on GitHub")
    parser.add_argument("--project", help="GitHub Project title to add issues to")
    args = parser.parse_args()

    seed = json.loads(args.seed.read_text())
    repo = seed["repository"]
    project = args.project if args.project is not None else seed.get("projectTitle")

    if args.apply:
        labels = existing_labels(repo)
        milestones = existing_milestones(repo)
        issue_titles = existing_issue_titles(repo)
    else:
        labels = set()
        milestones = set()
        issue_titles = set()

    for label in seed["labels"]:
        if label["name"] in labels:
            print(f"SKIP label exists: {label['name']}")
            continue
        create_label(repo, label, args.apply)

    for milestone in seed["milestones"]:
        if milestone["title"] in milestones:
            print(f"SKIP milestone exists: {milestone['title']}")
            continue
        create_milestone(repo, milestone, args.apply)

    for issue in seed["issues"]:
        if issue["title"] in issue_titles:
            print(f"SKIP issue exists: {issue['title']}")
            continue
        create_issue(repo, issue, project, args.apply)

    mode = "applied" if args.apply else "dry-run complete"
    print(f"Backlog {mode}: {repo}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
