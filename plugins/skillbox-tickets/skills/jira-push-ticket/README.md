# jira-push-ticket

Turns a markdown ticket draft into a Jira issue, then leaves the repository consistent with the
move.

`SKILL.md` is the instruction set, written for the model. This file is the human-facing summary.

## What it does

Six phases, in order, for one draft:

| Phase | What |
|---|---|
| 1 — Plan | Choose project, issue type and priority; find every inbound reference; **present the plan and wait for approval** |
| 2 — Create | One `createJiraIssue` call, body authored as HTML |
| 3 — Link | Relationship sections become real Jira issue links |
| 4 — Rewrite | Every file referencing the draft is pointed at the issue's browse URL |
| 5 — Rename | `git mv` the draft to `<KEY>.md` |
| 6 — Verify | Read the issue back as HTML and confirm the six things that can silently go wrong |

Nothing after phase 1 runs before you approve.

## Why phases 3 to 5 are not optional

A draft that moves without them leaves dead links in every ADR, spec and sibling draft that named
it. They fail silently — the link still renders, and a reader only finds out by following it.

## What it needs

| | |
|---|---|
| Config | `jira.site`, `jira.projects`, `jira.severityToPriority`, `paths.draftRoot`, `paths.docRoots` — see [CONFIG.md](../../CONFIG.md) |
| Atlassian MCP | **Required.** Shipped with the plugin; see the [plugin README](../../README.md) |
| Git | The rename is `git mv`, and the final check is `git status` |

Issue types, priority names and link type names are **not** configured. They are read from the site
at the point of use, so a project that gains a type or a site that renames a priority needs no edit
here.

## Safety properties worth knowing

- **It refuses to push twice.** A draft named `<KEY>.md`, or carrying a legacy `Issue` field, stops
  the run. Pushing twice is the one mistake here that cannot be undone quietly — a stray issue stays
  in the board's history even after it is closed.
- **One draft at a time.** Several drafts are pushed strictly in sequence, ordered by citation, so
  a draft that cites another gets a real key rather than a path about to disappear.
- **Nothing is staged.** You review the working tree yourself.

## Why the body is HTML

The MCP accepts markdown and converts it, but the converter drops task lists and truncates bold
that contains inline code — both appear in almost every draft.
[references/html-mapping.md](references/html-mapping.md) has the mapping for every construct, the
three that need care, and what Jira refuses outright.

## Files here

| File | What |
|---|---|
| `SKILL.md` | the instructions |
| `references/html-mapping.md` | markdown to Jira HTML, construct by construct |
