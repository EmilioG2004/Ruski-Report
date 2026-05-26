# Backlog

The operational backlog is managed in GitHub Issues and GitHub Projects:

- GitHub Project: https://github.com/users/EmilioG2004/projects/1
- GitHub Issues: https://github.com/EmilioG2004/Ruski-Report/issues

Use this repo only for the source seed and automation:

- `docs/project-management/github-backlog-seed.json`
- `scripts/create_github_backlog.py`

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
