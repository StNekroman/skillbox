# to-kb

Adds to a repository's knowledge base: agent-written pages about the world the product lives in —
the services it integrates and how they behave, the rules outside parties enforce, laws and
policies, research about its market and users, know-how the team wants to keep. The pages are
committed with the code, so the team shares them, and the next agent reads the page before it
works with that service or topic.

`SKILL.md` is the instruction set, written for the model. This file is the human-facing summary:
what the skill does, when it fires, and what it needs.

## What it produces

A new page, `<kbRoot>/KBDOCnnn-<slug>/`, or sections added to or corrected in an existing one; often
nothing. Nothing is written without your yes: the skill lists each fact it would add, with its
source and the page it would go to, and writes only what you confirm. When you ask for something to
be added, that request is the yes.

Every fact an agent adds from its own research cites a source — a URL with the date it was read, a
file in `<kbRoot>/attachments/`, or a record in the page's `Evidence` section — and what you state
is cited as yours, with the date. That is the knowledge base's answer to the question an SDD answers
by reading the code: where did this come from, and is it still true.

How the repository's own code works stays in the SDDs, which [to-sdd](../to-sdd/README.md) keeps; a
decision with the options weighed goes to an ADR, through [to-adr](../to-adr/README.md). The two
stores cite each other freely: an SDD rule that exists because of an outside constraint cites the
knowledge-base section holding it, and a page may link the code it is about.

## The format

The same as the SDDs', described in [to-sdd's README](../to-sdd/README.md#the-format): one folder
per topic, a `README.md` with a title, a summary of at most 500 characters and a generated index,
sections as headings that carry their anchor (`### §3.2 Title`), cited everywhere as
`KBDOC003§3.2`, numbers frozen, files split and merged by size. Binaries go in
`<kbRoot>/attachments/`.

What differs is what the checker looks for in the text. History wording, code samples and outside
names are content on these pages, so `lint` does not flag them; it keeps labels in titles, paths
the repository does not have, and links that point at nothing.

## When it fires

When you ask for something to be added to the knowledge base, or when an agent finishes a task that
turned up research or outside facts worth keeping and you agree to keep them. The second needs the
repository's agent instructions to say so: on first use the skill runs the shared init, which sets
up both stores and proposes one block for `CLAUDE.md` or `AGENTS.md` covering SDDs and the knowledge
base. It writes that block only once you confirm. The init and the block are the same in `to-sdd`.

A page that links our code is not forgotten when that code changes: `to-sdd` runs
`refs --changed`, which lists every knowledge-base section linking a changed file, and reports them
with a suggestion to run `to-kb`.

## What it needs

| | |
|---|---|
| Config | `paths.kbRoot`, `kb.maxLines` and `kb.index` — see [references/config.md](references/config.md). The limit has no default; the init writes 500, and git-ignores the index file |
| Git | For `refs --changed`, `next` and the Stop hook. `check`, `fix`, `lint`, `index` and the start-of-turn hook work without it |
| Tools | Read, grep, git, web access for research, and the script. It never runs builds or tests |

## Files here

| File | What |
|---|---|
| `SKILL.md` | the instructions |
| `references/format.md` | the doc format, shared with `to-sdd` |
| `references/config.md` | the keys of `.skillbox/tickets.json` both skills read, and the init that fills them |
| `references/instructions-block.md` | the block proposed for a repository's `CLAUDE.md` or `AGENTS.md`, shared with `to-sdd` |
| `scripts/doc-check.js` | the checker the skill and both hooks run, shared with `to-sdd` |
| `scripts/lib/doc-model.js` | the doc model the checker is built on |

`references/` and `scripts/` are copies written by `npm run sync` from the plugin's
[`scripts/doc-check/`](../../scripts/doc-check/); edit the source there, never a copy.
