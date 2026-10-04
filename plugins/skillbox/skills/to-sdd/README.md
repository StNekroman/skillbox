# to-sdd

Keeps a repository's SDDs true. An SDD is agent-written memory of one feature area or shared
mechanism — what it does, how its parts fit, the rules other code follows — committed to the
repository and read by the next agent before it changes that area. The skill runs at the end of a task that changed code and
corrects, extends or creates the SDDs the change touched. It also corrects what a task found an SDD
getting wrong, change or not, and records what a task worked out about an area once you agree. Beside the SDDs sits the repository's
knowledge base — pages about the world outside the code — which [to-kb](../to-kb/README.md) keeps;
this skill never edits those pages.

`SKILL.md` is the instruction set, written for the model. This file is the human-facing summary:
what the skill does, when it fires, and what it needs.

## What it produces

Usually a few corrected or added sections; often nothing. The bar is architecture: a change that
alters how a feature area is built, or that makes something an SDD states wrong. Bug fixes,
refactors, renames, tests, config values and field-level detail stay out — unless an SDD already
states that detail, in which case it is corrected rather than left wrong.

One SDD per area: a feature, or a mechanism several features rely on, such as tenant isolation or
authorization. A new one is created for an area no SDD covers, or for a mechanism once a second
area relies on it: its section moves out of the first area's SDD, leaving its heading titled
`(removed; see SDD012§2)`, and every citation is repointed. A rule several areas follow is stated once, in the
mechanism's SDD, and cited everywhere else. A copy would stay wrong when the rule changes, because
only the section the mechanism's code cites is found.

## The format

Each SDD is a folder under `paths.sddRoot`:

```
docs/sdd/
  SDD001-email-notifications/
    README.md     ← title, an abstract of at most 500 characters, the generated index,
                    and every section not moved out — §1, §2 and §4 here, with a
                    pointer to 3.md between §2 and §4
    3.md          ← §3, the largest, moved out when README.md passed the size limit,
                    with its small subsections and a pointer to 3.2.md
    3.2.md        ← §3.2, moved out when 3.md passed it
```

- **Sections are headings that carry their anchor** — `### §3.2 Retries with backoff` — so a
  reference like `SDD001§3.2` finds its heading wherever it lives, with one grep.
- **References are always ids, never paths**: `SDD001§3.2` in code, in other SDDs, in tickets and
  ADRs, always in the full form. An id never moves; a path moves whenever files split or merge.
- **Numbers are frozen; text is not.** A section is never renumbered and a number never reused. Its
  text is rewritten in place whenever it stops being true. A removed section keeps its heading,
  titled `(removed; see §3.6)`.
- **Files split and merge by size.** When a file passes `sdd.maxLines`, its largest subsections
  move into files of their own, named for their anchors, until it is within two-thirds of the
  limit; small ones stay with their parent, so no file is a stub. A section file that would fit
  back into its parent's file within two-thirds of the limit is merged back. Splitting only above
  the limit and merging only up to two-thirds of it means neither undoes the other, and a few
  lines of editing do not move sections around. A section lives in `<anchor>.md`, or else in the
  file of its nearest parent section that has one. A small SDD stays one `README.md`.
- **A moved section leaves a pointer.** Where it was, the file keeps its heading as a link to its
  file, `### [§3.2 Retries with backoff](3.2.md)`, so whoever reads that file top to bottom meets
  every subsection in order instead of a gap in the numbering.
- **Generated, never hand-written**: the index in `README.md`, the breadcrumb at the top of each
  section file, the pointers, heading levels. The index links each section's heading, in the file
  holding it, so one read of `README.md` is a map of the whole SDD.
- **The folder names are the way in.** An agent finds the SDD for an area by listing
  `paths.sddRoot`, so a title names the area in the words its code uses. Code cites the section at
  its entry point, which is the other way in.

Knowledge-base pages, `KBDOCnnn` under `paths.kbRoot`, share this format; the rules are in
`references/format.md`, the same file in both skills.

## When it fires

At the end of a task that changed code. Also at the end of a task that changed none, in two cases:

- **The agent found an SDD statement the code contradicts.** It is corrected without asking, since
  the next agent would trust it. The exception is a rule other code must follow: code that breaks
  it may be the bug, so the skill leaves the rule and reports the breach.
- **The agent had to work out how an area works, and no SDD holds what it found.** It asks you
  first, since every recorded line is one more to keep true. On yes, the skill reads the area's
  code, rather than writing up the one path the task saw.

Installing the plugin is not enough to make any of that happen:
a skill is picked by matching its description to a request, and "the task is done" is not a
request. So on first use the skill runs an init shared with `to-kb`: it sets up both stores in
`.skillbox/tickets.json`, and proposes one block for the repository's agent instructions, telling
every session to read the SDD before changing an area and to invoke `to-sdd` after, and to read
and add to the knowledge base the same way. It writes that block only once you confirm. A
repository set up before the knowledge base existed goes through the init once more: it gets
`paths.kbRoot`, and the old SDD-only block is proposed for replacement.

Where the block goes depends on what the repository has. Claude Code reads `CLAUDE.md`, and reads
`AGENTS.md` only while there is no `CLAUDE.md`; most other agents read `AGENTS.md`. So the block
goes in `AGENTS.md` when that is the only file, or when `CLAUDE.md` imports it; in `CLAUDE.md` when
that is the only one; in both when both exist side by side; and in a new `AGENTS.md` when there is
neither.

It does not write ADRs — that is [to-adr](../to-adr/README.md)'s job — but an SDD section links the
ADR behind a design choice when there is one. Nor does it edit knowledge-base pages: when a change
touches code that a page links, the report names that page's section and suggests `to-kb`.

## The script and the hook

`scripts/doc-check.js`, in this folder, does everything mechanical, so the model never moves text
between files by hand. It serves SDDs and knowledge-base pages alike. The skill carries its own copy
so that the folder works installed on its own; the copy, like `references/`, is written by
`npm run sync` from the plugin's [`scripts/doc-check/`](../../scripts/doc-check/), whose
internals and tests are documented in the plugin's
[scripts README](../../scripts/README.md#the-doc-checker).

| Command | What |
|---|---|
| `check [ID …]` | Every rule, including every reference to a doc anywhere in the repository |
| `fix [ID …]` | Regenerates indexes, breadcrumbs and pointers, sets heading levels, puts misplaced sections where they belong, merges back section files that fit, splits files over the limit |
| `lint [ID …]` | Leads for the content rules, all warnings: wording that tells history, fenced code, names in backticks the code no longer has, links that point at nothing |
| `refs --changed` | The sections the changed code cites, and the knowledge-base sections that link changed files — how the skill finds what a change may have made wrong |
| `refs --to ID[§x.y]` | Everything that cites a doc or a section |
| `next SDD` | The id a new SDD takes, counting every number in git history, deleted ones included |
| `migrate [--dry-run]` | Single-file SDDs (`SDDnnn-slug.md`) into folders, links to them into ids, short-form references into the full form |

`check` sees a reference however it was written, a section's title included: in a list
(`SDD006§2.4.1/§12`, `SDD013§4.2 and §5.1`), after a space (`SDD007 §8`), in parentheses after an
id (`SDD001 (esp. §7)`), or with a label where the number belongs (`SDD013§P6`, reported with the
headings that carry the label).
Each of these is an error, so none can quietly read as the citing doc's own section. A line-number
citation in an SDD is an error too. `migrate` writes the forms it can resolve in the full form, so
what is left after it is the work for the agent: `check` lists the reference errors, `lint` the
content leads.

The plugin also ships a **Stop hook** that runs the same rules at the end of every turn, on the doc
folders — SDDs and knowledge-base pages — changed since `HEAD` only. It is silent when they pass; when they do not, it sends the
problems back to the agent — the `fix` command to run, and what to repair by hand — and the turn
continues. It never rewrites anything itself, and it lets a turn end once it has been sent back
once. In a repository with neither `paths.sddRoot` nor `paths.kbRoot` it does nothing.

The plugin sets the hook up in Claude Code. The script answers in the end-of-turn hook format of
Codex, Copilot CLI and Gemini CLI too, and in both of Cursor's, so it can be wired into those by
hand: `node <this folder>/scripts/doc-check.js hook` on their `Stop`, `agentStop`, `AfterAgent` or
`stop` event. That follows their documentation; only Claude Code has been tried. Where no hook is
set up, the skill's own `fix` and `check` are the only check.

## What it needs

| | |
|---|---|
| Config | `paths.sddRoot` and `sdd.maxLines`, set up with `paths.kbRoot` and `kb.maxLines` — see [references/config.md](references/config.md). The limits have no default; the init writes 500 |
| Git | For `refs --changed`, `next` and the hook. `check`, `fix`, `migrate` and `lint` work without it |
| Tools | Read, grep, git, and the script. It never runs builds or tests |

## Files here

| File | What |
|---|---|
| `SKILL.md` | the instructions |
| `references/format.md` | the doc format, shared with `to-kb` |
| `references/config.md` | the keys of `.skillbox/tickets.json` both skills read, the init that fills them, and where the instructions block goes |
| `references/instructions-block.md` | the block proposed for a repository's `CLAUDE.md` or `AGENTS.md`, shared with `to-kb` |
| `scripts/doc-check.js` | the checker the skill and the Stop hook run |
| `scripts/lib/doc-model.js` | the doc model the checker is built on |

`references/` and `scripts/` are copies written by `npm run sync`; edit the source in the
plugin's `scripts/doc-check/`, never a copy.
