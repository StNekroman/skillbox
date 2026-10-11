# to-glossary

Records the domain terms a conversation settled in the repository's glossary: one name for each
concept, what it means, and the words not to use for it.

`SKILL.md` is the instruction set, written for the model. This file is the human-facing summary:
what the skill does, when it fires, and what it needs.

## Why it exists

Names drift. Each session, an agent reaches for a new word for a thing that already has one — a
Run becomes a job, then an execution, then a task — and you spend turns getting back on the same
page. Every new word in a spec or a ticket is one more the next session picks up and keeps going
with.

The glossary is the cure only together with the rules that make sessions read it. So the work is
split in two:

- **Reading** is always on. Once the config names the glossary, the block that `to-sdd` and `to-kb`
  keep in `CLAUDE.md` or `AGENTS.md` tells every session to read it before working on the domain,
  to call each concept by its term and never by a word the glossary avoids, to propose and ask
  before coining a name, and to point it out when you use a word the glossary avoids. That part
  works with no skill loaded, which matters: a skill that has to load itself to push back mostly
  doesn't.
- **Writing** is this skill, and only this skill. It runs when a term was settled: you picked one
  of two words, renamed or narrowed a term, or named a new concept.

None of it needs code. The glossary holds what a thing is, never how it is built, so it works
the same for a design that exists only as specs and tickets.

## What it produces

Usually nothing. When the conversation settled a term that clears the bar, it adds, rewrites or
removes entries in one markdown file, `paths.glossary` from
[the repository config](references/config.md). An entry is two lines:

```md
**Order**: A **Customer**'s request to buy one or more goods from one **Shop**.
_Avoid_: purchase, transaction, basket
```

The `_Avoid_` line does the most work: it names the words a session must not use for the concept.
[The format](references/glossary-format.md) has the whole file, groups included. A glossary the
repository already keeps in another shape keeps its own.

## The bar

A term qualifies when it names a concept of the product's domain, was settled by you — chosen,
or proposed to you and agreed — and someone could get it wrong: more than one word was in play,
the word means something narrower here than elsewhere, or the concept is new. General programming
words, technologies, and the names of modules, tables and fields never qualify. A word an agent
used and nobody remarked on is not settled. Recording it would turn an agent's habit into the
project's language.

Asked to build a glossary from a spec, a set of tickets or the repository, the skill proposes
entries and writes only those you confirm.

## What it reports

Each term added, changed or removed; the candidates it held below the bar; the conflicts it could
not settle alone, such as a word you chose that the glossary avoids. It also lists the documents
that still use a word that just moved to `_Avoid_`, which it never edits: an accepted ADR is never
edited, and a draft may be in review.

## When it fires

When a term was settled, before a ticket or a doc uses it, and at the latest when the task is
done. The block in the agent instructions says so, so the skill fires without being asked.

[draft-ticket](../draft-ticket/README.md) reads the glossary too, and names each concept in a
ticket by its term, in repositories without the block as well.

## What it needs

| | |
|---|---|
| Config | `paths.glossary` |
| The block | The rules that make sessions read the glossary live in the block the `to-sdd` and `to-kb` init places. Without it, only this skill and `draft-ticket` read the glossary |
| Tools | Read, grep, `git grep`, and the script, for the agent block. It never runs builds or tests |

## Credits

The entry shape — a term, a one- or two-sentence definition, and the words to avoid — follows Matt
Pocock's [`domain-modeling`](https://github.com/mattpocock/skills) skill, which absorbed his
earlier `ubiquitous-language`.

## Files here

| File | What |
|---|---|
| `SKILL.md` | the instructions |
| `references/glossary-format.md` | the built-in shape of the glossary, with an example |
| `references/config.md` | the key of `.skillbox/tickets.json` this skill reads, and the init that fills it |
| `references/instructions-block.md` | the agent block's template, which the script reads; written by `npm run sync` |
| `scripts/` | `doc-check.js`, the plugin's doc checker, here for `instructions`; written by `npm run sync` from the plugin's [`scripts/doc-check/`](../../scripts/doc-check/) |
