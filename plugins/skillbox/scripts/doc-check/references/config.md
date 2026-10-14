# Repository configuration

`to-sdd` and `to-kb` read one file: `.skillbox/tickets.json`, under the root of the repository
being worked in. It is committed, so a team shares one answer. This reference is the same in both
skills, and so is the init below: whichever of the two runs first sets up both stores.

The file is shared. The `draft-ticket`, `to-adr`, `to-glossary`, `to-sdd`, `to-kb` and
`jira-push-ticket` skills each read it and each fill only the keys they need, so whichever runs
first creates it and the others add to it. Never remove or rewrite a key these skills do not use.
The file is named for the
ticket skills; where SDDs and knowledge-base pages live are two more of the repository's document
paths, and `jira-push-ticket` has to know them all to rewrite links inside them, so one file
answers every path question.

`scripts/doc-check.js` reads the same file, and finds the repository by walking up to it. The Stop
hook that runs the script does nothing in a repository whose file names neither `paths.sddRoot`
nor `paths.kbRoot`.

## The keys these skills use

```json
{
  "version": 1,
  "paths": {
    "sddRoot": "devdoc/sdd",
    "kbRoot": "devdoc/kb",
    "docRoots": ["devdoc/architecture-decisions", "devdoc/kb", "devdoc/sdd", "devdoc/specs", "devdoc/tech"]
  },
  "sdd": {
    "maxChars": 24000,
    "index": { "path": "devdoc/sdd/index.generated.md", "summary": "paragraph", "depth": 0 }
  },
  "kb": {
    "maxChars": 24000,
    "index": { "path": "devdoc/kb/index.generated.md", "summary": "paragraph", "depth": 0 }
  },
  "adr": {
    "index": { "path": "devdoc/architecture-decisions/index.generated.md" }
  }
}
```

| Key | Meaning |
|---|---|
| `paths.sddRoot` | Where SDD folders live, relative to the repository root. Read by `to-sdd`, the script and the Stop hook |
| `paths.kbRoot` | Where knowledge-base page folders live, and their `attachments/` folder. Read by `to-kb`, the script and the Stop hook |
| `sdd.maxChars`, `kb.maxChars` | The most characters one file of that type may hold before `doc-check.js fix` moves its subsections into files of their own. Characters, not lines: a paragraph is one line however long it runs. No default: the init writes them |
| `sdd.index`, `kb.index` | The store's index: one file listing every doc, its title linking its `README.md`, then its summary. Without the key there is no index. See `The index` |
| `adr.index` | The ADR index, for a repository whose file has `paths.adrRoot`: one file listing every architecture decision record, its title linking the file, then its status. The `to-adr` skill keeps the records; the script, the hook and the agent instructions only list them |
| `paths.docRoots` | Directories searched for inbound references to a ticket draft when it is pushed to a tracker. These skills only add `sddRoot` and `kbRoot` to it |

### The index

An agent reads the store's index to choose which docs to open, instead of guessing from folder
names. `doc-check.js` writes it from the docs and rewrites it whenever they no longer match: `fix`
after it changes docs, `index` when run by hand, and the start-of-turn hook before every prompt,
where the hook is set up. So the index is never edited and never committed.

| Key | Default | Meaning |
|---|---|---|
| `path` | `<root>/index.generated.md` | Where the file goes, relative to the repository root. Not inside a doc folder. Stores may name the same file; it then lists each, under a heading of its own |
| `summary` | `"paragraph"` | What each entry shows of the doc's summary: `"paragraph"`, the whole of it; `"sentence"`, its first sentence; `"none"` |
| `depth` | `0` | How many levels of section titles each entry lists under the summary. `0` lists none |

A key left out takes its default, so `"index": {}` is enough. With summaries near the limit, the
defaults make about 600 characters per doc, and one level of sections about 900.

`adr.index` takes only `path`: a record is listed by its title, which names the decision, and its
status, and its sections are not numbered for a deeper list. A record is a markdown file directly
in `paths.adrRoot` whose name carries a number — `ADR-7-…`, `adr-007-…`, `0007-…` — other than the
template `paths.adrTemplate` names.

## When the file or a key is missing

Do not guess, and do not fall back to defaults. Run this, then continue with the task that was
asked — the init is a step inside the work, not a reason to stop and hand it back.

The init covers all six keys above, whichever skill runs it, and `adr.index` when the file has
`paths.adrRoot`. Fill only the ones that are missing: a repository set up for SDDs before the
knowledge base existed gets `paths.kbRoot`, `kb.maxChars` and `kb.index` now, one set up before
the index existed gets `sdd.index` and `kb.index`, one whose ADRs predate their index gets
`adr.index`, and one whose limits still count lines, `sdd.maxLines` and `kb.maxLines`, gets
`sdd.maxChars` and `kb.maxChars` in their place.

1. **Find the repository root.** `git rev-parse --show-toplevel`. Create `.skillbox/` there if it
   does not exist, and write the file inside it.
2. **Discover before asking.** The sections below say where to look. Propose what you found; ask
   only for what you could not, both roots in one question when neither was found.
3. **Write the keys**, leaving the rest of the file untouched, then say in one line what was
   written and that it is meant to be committed.
4. **Settle the agent instructions**, as `The agent instructions` describes. Do this in every run
   where the init wrote a key, and only then.

Fill only the keys below. Where ticket drafts or ADRs go is not this init's question; the ADR index
is, once `paths.adrRoot` says where they are.

### `paths.sddRoot` and `sdd.maxChars`

Look for a directory that already holds SDDs: folders named like `SDD001-email-notifications/`,
files named like `SDD001-email-notifications.md`, or a directory named `sdd` or `sdds` — an entry
in `docRoots` included. One such directory has answered `sddRoot` itself. None, or several, means
ask where SDDs should go, proposing `sdd` beside the repository's other docs.

### `paths.kbRoot` and `kb.maxChars`

Look for a directory that already holds knowledge-base pages: folders named like
`KBDOC001-merchant-center/`, or a directory named `kb` — an entry in `docRoots` included. One such
directory has answered `kbRoot` itself. None, or several, means ask, proposing `kb` beside the SDD
root: `devdoc/kb` when `sddRoot` is `devdoc/sdd`.

### Both

Add `sddRoot` and `kbRoot` to `docRoots`, creating the list if there is none — with any other doc
directories you found on the way. A doc that cites a ticket draft is an inbound reference
`jira-push-ticket` must rewrite, and it searches only `docRoots`.

Write `sdd.maxChars` and `kb.maxChars` as `24000` without asking, and say in the one-line report
that they are there to tune. At that size an agent reads a whole file in one call: Claude Code cuts
a shell command's output at 30,000 characters. Never leave one out: `doc-check.js` has no default,
so that the limit in force is always the one written in the file. A lower value splits the files
over it at the next `fix`; a higher one lets `fix` merge back the section files that then fit.

An `sdd.maxLines` or `kb.maxLines` is the limit from before it counted characters, and the script
no longer reads it. Remove it as you write the `maxChars` key beside it, then run
`doc-check.js fix`, which splits the files the new limit puts over it, and say so in the report.

### `sdd.index`, `kb.index` and `adr.index`

Write `sdd.index` and `kb.index` with every key spelled out, so the values in force are visible:
`{ "path": "<root>/index.generated.md", "summary": "paragraph", "depth": 0 }`. Do not ask; say in
the one-line report that `summary` and `depth` are there to tune. When the file has
`paths.adrRoot`, write `adr.index` as `{ "path": "<adrRoot>/index.generated.md" }` the same way.

Then make git ignore the files. Add their paths to the repository's root `.gitignore`, creating it
if there is none, unless a rule there already covers them. `check` warns about an index git would
commit: a committed copy conflicts on every merge that brings new docs, and goes stale wherever no
hook rewrites it.

Then run `doc-check.js index`, which writes them.

## The agent instructions

An agent reads the SDDs before changing code, and the knowledge base before working with an
outside service, only when the repository's always-loaded instructions tell it to. The same holds
for the ADR index before a design choice: the block names it when the file has `adr.index`. And
for the glossary, the one name for each concept of the domain: the block holds every session to
its terms when the file has `paths.glossary`, which the `to-glossary` skill sets. Two files at
the repository root carry those: `CLAUDE.md`, which Claude Code reads, and `AGENTS.md`, which most
other coding agents read. Claude Code reads `AGENTS.md` too, but only while there is no
`CLAUDE.md`. Here `CLAUDE.md` means `CLAUDE.md` or `.claude/CLAUDE.md`.

Look for both, then pick where the block goes:

| The repository has | The block goes in |
|---|---|
| A `CLAUDE.md` that imports `@AGENTS.md`, or is a symlink to it | `AGENTS.md`. Every agent reads it from there |
| Only `AGENTS.md` | `AGENTS.md` |
| Only `CLAUDE.md` | `CLAUDE.md` |
| Both, and `CLAUDE.md` does not import `AGENTS.md` | Both. Claude Code reads only `CLAUDE.md` here, and other agents only `AGENTS.md` |
| Neither | A new `AGENTS.md` holding only the block. Claude Code reads it while there is no `CLAUDE.md`, and so do most other agents |

Then, for each file the block goes in:

- **It has no rules for either store.** Propose adding [the instructions block](instructions-block.md). `scripts/doc-check.js instructions --dry-run <file>` shows it with the paths filled in; on yes, run it without `--dry-run`.
- **It already has the block in an older form** — between its markers, or bare under `## SDDs` or `## SDDs and the knowledge base`. `scripts/doc-check.js instructions --dry-run` shows the lines that go and the lines that come; on yes, run it without `--dry-run`.
- **It has SDD rules written another way.** Propose removing them and adding the block, and show both.

Write only after the user confirms. These files shape every future session in the repository.

The block sits between two markers, and the start marker carries the version of the block. `instructions` rewrites only what lies between them, so the repository's own rules go outside. When the skills ship a newer block, `check` warns about the older copy, and `instructions` brings it up to date. A copy written by a newer plugin is left alone, so teammates a version apart do not undo each other's update.

## `.skillbox/` and git

`.skillbox/tickets.json` is committed, because the team shares it. Anything derived,
per-developer or regenerable goes under `.skillbox/cache/`, and the consuming repository should
ignore that one path:

```gitignore
.skillbox/cache/
```

The store indexes, the ADR index among them, are derived too, but sit beside the docs by default, where an agent listing the
store finds them; their own lines in `.gitignore` cover them. Nothing here holds a secret, so
nothing else needs ignoring. Suggest the `.skillbox/cache/` line when writing the config into a
repository that has no `.skillbox/` yet, rather than ignoring `.skillbox/` wholesale — that would
drop the configuration the team is meant to share.
