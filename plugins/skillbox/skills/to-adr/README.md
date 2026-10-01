# to-adr

Records the architecture decisions a conversation settled as ADR files: what was decided, what else
was on the table, why it lost, and what the decision costs.

`SKILL.md` is the instruction set, written for the model. This file is the human-facing summary:
what the skill does, when it fires, and what it needs.

## What it produces

Usually nothing. When the conversation settled a decision that clears the bar, it writes one
markdown file per decision under `paths.adrRoot` from
[the repository config](references/config.md), named `ADR-<n>-<slug>.md`. A directory that already
names its records another way — `0007-use-cas.md`, say — keeps its own pattern.

The shape comes from, in order: the repository's own template at `paths.adrTemplate`, the records
already in the directory, or the built-in [template](references/adr-template.md). The built-in has
`Context`, `Decision`, `Alternatives considered`, `Consequences` and `Revisit when`, under a field
list of date, status, related documents and the record it supersedes. Each section carries a
comment saying what it holds and whether it is mandatory, so the file doubles as a starting point
for a repository's own `paths.adrTemplate`.

## The bar

An ADR directory is useful only while every file in it matters, so the skill decides whether to
write before it touches anything, including the config. A settled decision qualifies when it is
costly to reverse, reaches past one component, sets a precedent, or fixes a quality attribute such
as tenant isolation or data retention — and when a future engineer would plausibly ask "why didn't
they just …?".

Colours, naming, bug fixes, local refactors, tunable values and the like never qualify, however
long they were discussed. When nothing clears the bar the skill says so, names the closest
candidates and why they fell short, and writes nothing. Insisting after that gets you the record.

## What it never invents

The reasons behind a decision and the alternatives it beat come from the conversation or not at
all. A decision with no stated reason gets a question, not a plausible reason; an alternative
nobody weighed is never added to make the record look deliberate. Consequences are different: they
follow from the decision and may be derived, and every record carries at least one negative.

Claims about the system as it is today are checked against live code, and cited by module or path
rather than line — an accepted record is never edited, and a line number goes stale in weeks.

## When it fires

When a design discussion has reached a decision worth keeping. It does not write tickets — that is
[draft-ticket](../draft-ticket/README.md)'s job — but when a draft in the same conversation
implements the decision, the draft's `References` gains a link to the record.

## What it needs

| | |
|---|---|
| Config | `paths.adrRoot`; optionally `paths.adrTemplate`, and `jira.site` when a record cites an issue |
| Atlassian MCP | Optional; it arrives with the `skillbox-jira` addon. Used only to verify a cited issue key and read its summary |
| Tools | Read, grep and `git log`. It never runs builds or tests |

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
