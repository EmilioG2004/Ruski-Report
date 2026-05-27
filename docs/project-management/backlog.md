# Backlog

The operational backlog is managed in GitHub Issues and GitHub Projects:

- GitHub Project: https://github.com/users/EmilioG2004/projects/1
- GitHub Issues: https://github.com/EmilioG2004/Ruski-Report/issues

Use this repo only for source documentation, backlog seeding, and automation:

- `docs/project-management/github-backlog-seed.json`
- `scripts/create_github_backlog.py`

GitHub Issues is the source of truth for active work. Do not maintain a
parallel hand-edited backlog in this repository after issues have been imported.

## Workflow

Every backlog item should follow this path:

```text
Issue -> Milestone -> Sprint -> Status
```

Use the GitHub issue for the work description, discussion, acceptance criteria,
and closing history. Use the GitHub Project for planning fields and day-to-day
status tracking.

### Status

Use the project `Status` field as the primary work-state indicator:

- `Todo`: Work is defined but not currently active.
- `In Progress`: Work is actively being designed, implemented, reviewed, or
  otherwise moved forward.
- `Done`: Work is complete and the linked issue should be closed, or is already
  closed.

### Milestones

Use milestones to group work by delivery phase:

- `M1: Project Setup & Planning`
- `M2: Backend Platform Foundation`
- `M3: Ruski Scorebook Ingestion`
- `M4: iOS Tournament Viewer`
- `M5: Match Detail & Live Updates`
- `M6: v1 Tournament Release`

Milestones define the major sequence of the project. Sprint assignment defines
the current planning window.

### Sprints

Use the project `Sprint` field to identify near-term work:

- `Backlog`: Valid work that is not planned for an active sprint.
- `Sprint 1`: Current first execution window.
- `Sprint 2`, `Sprint 3`, `Sprint 4`: Future planning windows.

Sprint membership should be updated in GitHub Projects, not in this file.

### Labels

Use labels for filtering and planning:

- `area:*`: Where the work primarily lives, such as iOS, backend, data, infra,
  or docs.
- `type:*`: What kind of work it is, such as feature, task, spike, or bug.
- `priority:*`: Relative ordering pressure, using high, medium, or low.

When a new issue is created manually, choose the matching issue form so the
correct `type:*` label is applied automatically, then add the area and priority
labels as needed.

## Issue Forms

Use these GitHub issue forms:

- `Feature`: User-facing or platform behavior.
- `Task`: Implementation, setup, documentation, or cleanup work.
- `Spike`: Time-boxed research for an unresolved decision.
- `Bug`: Broken behavior with reproduction steps.

Blank issues are disabled so that new work is structured consistently.

## Operating Rules

- Keep acceptance criteria concrete and testable.
- Prefer one issue per independently reviewable unit of work.
- Link pull requests to issues so GitHub can show implementation history.
- Move an issue to `In Progress` when active work begins.
- Move an issue to `Done` and close it when acceptance criteria are met.
- Update milestone, sprint, priority, and assignment in GitHub rather than
  editing this file.

Preview the GitHub backlog creation:

```bash
python3 scripts/create_github_backlog.py
```

Create labels, milestones, and issues on GitHub:

```bash
python3 scripts/create_github_backlog.py --apply
```

Add created issues to a GitHub Project by title:

```bash
python3 scripts/create_github_backlog.py --apply --project "Ruski Report"
```

After import, update issue status, sprint/iteration, priority, and assignment in GitHub rather than editing a duplicate local backlog.

Current project fields:

- Status
- Sprint
- Estimate
- Labels
- Milestone
