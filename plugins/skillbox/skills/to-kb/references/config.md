# Repository configuration

`to-sdd` and `to-kb` read one file: `.skillbox/tickets.json`, under the root of the repository
being worked in. It is committed, so a team shares one answer. This reference is the same in both
skills, and so is the init below: whichever of the two runs first sets up both stores.

The file is shared. The `draft-ticket`, `to-adr`, `to-sdd`, `to-kb` and `jira-push-ticket` skills
each read it and each fill only the keys they need, so whichever runs first creates it and the
others add to it. Never remove or rewrite a key these skills do not use. The file is named for the
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
    "maxLines": 500
  },
  "kb": {
    "maxLines": 500
  }
}
```

| Key | Meaning |
|---|---|
| `paths.sddRoot` | Where SDD folders live, relative to the repository root. Read by `to-sdd`, the script and the Stop hook |
| `paths.kbRoot` | Where knowledge-base page folders live, and their `attachments/` folder. Read by `to-kb`, the script and the Stop hook |
| `sdd.maxLines`, `kb.maxLines` | The most lines one file of that type may hold before `doc-check.js fix` moves its subsections into files of their own. No default: the init writes them |
| `paths.docRoots` | Directories searched for inbound references to a ticket draft when it is pushed to a tracker. These skills only add `sddRoot` and `kbRoot` to it |

## When the file or a key is missing

Do not guess, and do not fall back to defaults. Run this, then continue with the task that was
asked — the init is a step inside the work, not a reason to stop and hand it back.

The init covers all four keys above, whichever skill runs it. Fill only the ones that are missing:
a repository set up for SDDs before the knowledge base existed gets `paths.kbRoot` and
`kb.maxLines` now, and nothing else changes.

1. **Find the repository root.** `git rev-parse --show-toplevel`. Create `.skillbox/` there if it
   does not exist, and write the file inside it.
2. **Discover before asking.** The sections below say where to look. Propose what you found; ask
   only for what you could not, both roots in one question when neither was found.
3. **Write the keys**, leaving the rest of the file untouched, then say in one line what was
   written and that it is meant to be committed.
4. **Settle the agent instructions**, as `The agent instructions` describes. Do this in every run
   where the init wrote a key, and only then.

Fill only the keys below. Where ticket drafts or ADRs go is not this init's question.

### `paths.sddRoot` and `sdd.maxLines`

Look for a directory that already holds SDDs: folders named like `SDD001-email-notifications/`,
files named like `SDD001-email-notifications.md`, or a directory named `sdd` or `sdds` — an entry
in `docRoots` included. One such directory has answered `sddRoot` itself. None, or several, means
ask where SDDs should go, proposing `sdd` beside the repository's other docs.

### `paths.kbRoot` and `kb.maxLines`

Look for a directory that already holds knowledge-base pages: folders named like
`KBDOC001-merchant-center/`, or a directory named `kb` — an entry in `docRoots` included. One such
directory has answered `kbRoot` itself. None, or several, means ask, proposing `kb` beside the SDD
root: `devdoc/kb` when `sddRoot` is `devdoc/sdd`.

### Both

Add `sddRoot` and `kbRoot` to `docRoots`, creating the list if there is none — with any other doc
directories you found on the way. A doc that cites a ticket draft is an inbound reference
`jira-push-ticket` must rewrite, and it searches only `docRoots`.

Write `sdd.maxLines` and `kb.maxLines` as `500` without asking, and say in the one-line report that
they are there to tune. Never leave one out: `doc-check.js` has no default, so that the limit in
force is always the one written in the file. A lower value later splits the files over it; a
higher one merges nothing back, since no path may move.

## The agent instructions

An agent reads the SDDs before changing code, and the knowledge base before working with an
outside service, only when the repository's always-loaded instructions tell it to. Two files at
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

- **It has no rules for either store.** Propose adding [the instructions block](instructions-block.md), with `<sddRoot>` and `<kbRoot>` filled in.
- **It already has rules in an older form** — an SDD-only block from before the knowledge base, or SDD rules written another way. Propose replacing them with the block, and show both the lines that go and the lines that come.

Write only after the user confirms. These files shape every future session in the repository.

## `.skillbox/` and git

`.skillbox/tickets.json` is committed, because the team shares it. Anything derived,
per-developer or regenerable goes under `.skillbox/cache/`, and the consuming repository should
ignore that one path:

```gitignore
.skillbox/cache/
```

Nothing here holds a secret, so nothing else needs ignoring. Suggest that line when writing the
config into a repository that has no `.skillbox/` yet, rather than ignoring `.skillbox/` wholesale
— that would drop the configuration the team is meant to share.
