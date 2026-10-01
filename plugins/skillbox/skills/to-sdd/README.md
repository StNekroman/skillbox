# to-sdd

Keeps a repository's SDDs true. An SDD is agent-written memory of one feature area — what it does,
how its parts fit, the rules other code follows — committed to the repository and read by the next
agent before it changes that area. The skill runs at the end of a task that changed code and
corrects, extends or creates the SDDs the change touched.

`SKILL.md` is the instruction set, written for the model. This file is the human-facing summary:
what the skill does, when it fires, and what it needs.

## What it produces

Usually a few corrected or added sections; often nothing. The bar is architecture: a change that
alters how a feature area is built, or that makes something an SDD states wrong. Bug fixes,
refactors, renames, tests, config values and field-level detail stay out — unless an SDD already
states that detail, in which case it is corrected rather than left wrong.

One SDD per feature area. A new one is created only for an area no SDD covers.

## The format

Each SDD is a folder under `paths.sddRoot`:

```
docs/sdd/
  SDD001-email-notifications/
    README.md     ← title, an abstract of at most 500 characters, the generated index,
                    and every section not moved out yet
    3.md          ← §3, moved out when README.md passed the size limit
    3.2.md        ← §3.2, moved out when 3.md passed it
```

- **Sections are headings that carry their anchor** — `### §3.2 Retries with backoff` — so a
  reference like `SDD001§3.2` finds its heading wherever it lives, with one grep.
- **References are always ids, never paths**: `SDD001§3.2` in code, in other SDDs, in tickets and
  ADRs, always in the full form. An id never moves; a path would move the moment a file splits.
- **Numbers are frozen; text is not.** A section is never renumbered and a number never reused. Its
  text is rewritten in place whenever it stops being true. A removed section keeps its heading,
  titled `(removed; see §3.6)`.
- **Files split by one fixed rule.** When a file passes `sdd.maxLines`, every direct subsection of
  the section it holds moves into its own file, named for its anchor. Siblings move together, and
  files are never merged back, so no path ever moves. A small SDD stays one `README.md`.
- **Generated, never hand-written**: the index in `README.md`, the breadcrumb at the top of each
  section file, heading levels. The index links each section to the file holding it, so one read of
  `README.md` is a map of the whole SDD.

## When it fires

At the end of a task that changed code. Installing the plugin is not enough to make that happen:
a skill is picked by matching its description to a request, and "the task is done" is not a
request. So on first use the skill proposes a short block for the repository's agent instructions,
telling every session to read the SDD before changing an area and to invoke `to-sdd` after. It
writes that block only once you confirm.

Where the block goes depends on what the repository has. Claude Code reads `CLAUDE.md`, and reads
`AGENTS.md` only while there is no `CLAUDE.md`; most other agents read `AGENTS.md`. So the block
goes in `AGENTS.md` when that is the only file, or when `CLAUDE.md` imports it; in `CLAUDE.md` when
that is the only one; in both when both exist side by side; and in a new `AGENTS.md` when there is
neither.

It does not write ADRs — that is [to-adr](../to-adr/README.md)'s job — but an SDD section links the
ADR behind a design choice when there is one.

## The script and the hook

`scripts/sdd-check.js`, in this folder, does everything mechanical, so the model never moves text
between files by hand. It ships inside the skill so that the folder works installed on its own;
its internals and tests are documented in the plugin's
[scripts README](../../scripts/README.md#the-sdd-checker).

| Command | What |
|---|---|
| `check [SDDnnn …]` | Every rule, including every reference to an SDD anywhere in the repository |
| `fix [SDDnnn …]` | Regenerates indexes and breadcrumbs, sets heading levels, splits files over the limit |
| `refs --changed` | The sections the changed code cites — how the skill finds what a change may have made wrong |
| `next` | The id a new SDD takes, counting every number in git history, deleted ones included |
| `migrate [--dry-run]` | Single-file SDDs (`SDDnnn-slug.md`) into folders, links to them into ids, short-form references into the full form |

The plugin also ships a **Stop hook**, Claude Code only, that runs the same rules at the end of
every turn, on the SDD folders changed since `HEAD` only. It is silent when they pass; when they do
not, it sends the problems back to the agent — the `fix` command to run, and what to repair by
hand — and the turn continues. It never rewrites anything itself, and it lets a turn end once it
has been sent back once. In a repository with no `paths.sddRoot` it does nothing. Where the skill
runs without the plugin, there is no hook: the skill's own `fix` and `check` are the only check.

## What it needs

| | |
|---|---|
| Config | `paths.sddRoot` and `sdd.maxLines` — see [references/config.md](references/config.md). The limit has no default; the init writes 500 |
| Git | For `refs --changed`, `next` and the hook. `check`, `fix` and `migrate` work without it |
| Tools | Read, grep, git, and the script. It never runs builds or tests |

## Files here

| File | What |
|---|---|
| `SKILL.md` | the instructions |
| `references/instructions-block.md` | the block proposed for a repository's `CLAUDE.md` or `AGENTS.md` |
| `references/config.md` | the keys of `.skillbox/tickets.json` this skill reads, and the init that fills them |
| `scripts/sdd-check.js` | the checker the skill and the Stop hook run |
| `scripts/lib/sdd-doc.js` | the SDD model the checker is built on |
