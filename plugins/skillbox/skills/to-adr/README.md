# to-adr

Records the architecture decisions a conversation settled as ADR files: what was decided, what else
was on the table, why it lost, and what the decision costs.

`SKILL.md` is the instruction set, written for the model. This file is the human-facing summary:
what the skill does, when it fires, and what it needs.

## What it produces

Usually nothing. When the conversation settled a decision that clears the bar, it first shows a
summary of a few lines and asks — see [Asking first](#asking-first). On a yes it writes one
markdown file per decision under `paths.adrRoot` from
[the repository config](references/config.md), named `ADR-<n>-<slug>.md`. The slug is two to four
words naming the approach, at most 30 characters — `ADR-7-content-addressable-storage.md` — never
the title as a sentence; the title inside the file, which the index lists, says the rest. A
directory that already names its records another way — `0007-use-cas.md`, say — keeps its own
prefix and numbering, but not long slugs.

The shape comes from, in order: the repository's own template at `paths.adrTemplate`, the records
already in the directory, or the built-in [template](references/adr-template.md). The built-in has
`Problem`, `Decision`, `Alternatives considered`, `Consequences` and `Revisit when`, under a field
list of date, status, related documents and the record it supersedes. Each section carries a
comment saying what it holds and whether it is mandatory, so the file doubles as a starting point
for a repository's own `paths.adrTemplate`.

## The ADR index

Beside the records sits a generated index, `adr.index` in the config: every record, its title
linking the file, then its status, so a superseded decision reads as one at a glance. Titles name
the decision rather than the topic, so the list alone tells an agent which records bear on a
choice. Unlike the SDD and knowledge-base indexes it lists no sections: records follow whatever
template the repository uses, and have none to list.

The block `to-sdd` and `to-kb` keep in `CLAUDE.md` or `AGENTS.md` sends every agent to the index
before a design choice that other code will follow: follow the accepted records, and ask before
going against one. That is how a decision made months ago reaches the agent about to undo it.

The index is git-ignored and rebuilt, never edited: the skill rewrites it after writing a record,
and the plugin's start-of-turn hook before every prompt. It runs the same `doc-check.js` as
`to-sdd` and `to-kb`, a copy of which ships in this folder. On first use the init adds the key,
git-ignores the file, and, where the block is already in place, proposes its update.

## The bar

An ADR directory is useful only while every file in it matters, so the skill decides whether to
write before it touches anything, including the config. A settled decision qualifies when it is
costly to reverse, reaches past one component, sets a structural precedent, or fixes a quality
attribute such as tenant isolation or data retention — and when a future engineer would plausibly
ask "why didn't they just …?". A contract whose every consumer ships from the same repository is
not costly to reverse, and when the skill is unsure whether a test holds, it does not.

Colours, layout, a UI component or library inside an established frontend, product rules such as a
feature's defaults or which setting overrides which, naming, bug fixes, local refactors, tunable
values and the like never qualify, however long they were discussed and however many places will
follow them. A change to something an existing record holds is held to the same bar: when it falls
short, the older record is marked superseded, pointing at wherever the change is recorded, and no
new record is written — so one record that should not exist does not breed more.

When nothing clears the bar the skill writes nothing. If you asked for an ADR, it says so and names
the closest candidates and why they fell short; if the agent ran it on its own at the end of a
task, it stays silent. Insisting after that gets you the summary, and a yes gets you the record.

## Asking first

No file in the ADR directory is created or changed until you have seen its summary and said yes —
even when you typed `/to-adr` yourself. The summary is a few lines in a code block, enough to
judge the idea at a glance:

```text
Content-addressable storage for file management
Decision  Identify each file by SHA-256 of its content; store it once
Why       Tenants upload the same files; retries must not duplicate
Rejected  Path-based keys: duplicates on re-upload
          Provider dedup: our provider doesn't offer it
Cost      Every read resolves hash → path through a lookup
Bar       Costly to reverse: data at rest
```

`Bar` says which test the decision clears, so a wrong call is easy to spot. A reason the
conversation never gave shows as `Why  ? — what decided it?`, and an alternative with no reason
for losing as `<alternative>: lost why?`, so one reply both fills the gaps and accepts the record.
Answer `yes`, `no`, or what to change; with several candidates, `1 yes, 2 no`. A no holds for the
rest of the conversation. The skill reads nothing beyond the existing records' titles before the
yes, and runs its first-use init only after it, so you are never asked where to store a record you
did not want.

## What it never invents

The reasons behind a decision and the alternatives it beat come from the conversation or not at
all. A decision with no stated reason gets a question, not a plausible reason; an alternative
nobody weighed is never added to make the record look deliberate. Consequences are different: they
follow from the decision and may be derived, and every record carries at least one negative.

Claims about the system as it is today are checked against live code, and cited by module or path
rather than line — an accepted record is never edited, and a line number goes stale in weeks.

## When it fires

When a conversation has settled how the system is built — where data lives, how components talk,
what may depend on what, a contract others rely on. Not for UI or product choices, however much
design discussion they took. Besides `/to-adr`, the agent block in `CLAUDE.md` or `AGENTS.md` tells
every agent to run it when a task that settled such a choice is done — safe because it asks first. It does not write tickets — that is
[draft-ticket](../draft-ticket/README.md)'s job — but when a draft in the same conversation
implements the decision, the draft's `References` gains a link to the record.

## What it needs

| | |
|---|---|
| Config | `paths.adrRoot` and `adr.index`; optionally `paths.adrTemplate`, and `jira.site` when a record cites an issue |
| Atlassian MCP | Optional; it arrives with the `skillbox-jira` addon. Used only to verify a cited issue key and read its summary |
| Tools | Read, grep, `git log`, and the script, for the index and the agent block. It never runs builds or tests |

## Superseding

An accepted record is never rewritten. A decision that reverses an earlier one becomes a new record
that says what it supersedes, and the old record's status becomes `Superseded` with a link forward
— the only edit it ever gets.

## Files here

| File | What |
|---|---|
| `SKILL.md` | the instructions |
| `references/adr-template.md` | the built-in template, used when the repository sets none; each section documents itself |
| `references/config.md` | the keys of `.skillbox/tickets.json` this skill reads, and the init that fills them |
| `references/instructions-block.md` | the agent block's template, which the script reads; written by `npm run sync` |
| `scripts/` | `doc-check.js`, the plugin's doc checker, here for `index` and `instructions`; written by `npm run sync` from the plugin's [`scripts/doc-check/`](../../scripts/doc-check/) |
