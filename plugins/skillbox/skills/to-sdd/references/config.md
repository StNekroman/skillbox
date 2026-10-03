# Repository configuration

This skill reads one file: `.skillbox/tickets.json`, under the root of the repository being worked
in. It is committed, so a team shares one answer.

The file is shared. The `draft-ticket`, `to-adr`, `to-sdd` and `jira-push-ticket` skills each read
it and each fill only the keys they need, so whichever runs first creates it and the others add to
it. Never remove or rewrite a key this skill does not use. The file is named for the ticket skills;
where SDDs live is one more of the repository's document paths, and `jira-push-ticket` has to know
them all to rewrite links inside them, so one file answers every path question.

`scripts/doc-check.js` reads the same file, and finds the repository by walking up to it. The Stop
hook that runs the script does nothing in a repository whose file names no `paths.sddRoot`.

## The keys this skill uses

```json
{
  "version": 1,
  "paths": {
    "sddRoot": "devdoc/sdd",
    "docRoots": ["devdoc/architecture-decisions", "devdoc/sdd", "devdoc/specs", "devdoc/tech"]
  },
  "sdd": {
    "maxLines": 500
  }
}
```

| Key | Meaning |
|---|---|
| `paths.sddRoot` | Where SDD folders live, relative to the repository root. Read by this skill, the script and the Stop hook |
| `sdd.maxLines` | The most lines one SDD file may hold before `doc-check.js fix` moves its subsections into files of their own. No default: the init writes it |
| `paths.docRoots` | Directories searched for inbound references to a ticket draft when it is pushed to a tracker. This skill only adds `sddRoot` to it |

## When the file or a key is missing

Do not guess, and do not fall back to defaults. Run this, then continue with the task that was
asked — the init is a step inside the work, not a reason to stop and hand it back.

1. **Find the repository root.** `git rev-parse --show-toplevel`. Create `.skillbox/` there if it
   does not exist, and write the file inside it.
2. **Discover before asking.** The section below says where to look. Propose what you found; ask
   only for what you could not.
3. **Write the keys**, leaving the rest of the file untouched, then say in one line what was
   written and that it is meant to be committed.

Fill only the keys below. Where ticket drafts or ADRs go is not this skill's question.

### `paths.sddRoot` and `sdd.maxLines`

Look for a directory that already holds SDDs: folders named like `SDD001-email-notifications/`,
files named like `SDD001-email-notifications.md`, or a directory named `sdd` or `sdds` — an entry
in `docRoots` included. One such directory has answered `sddRoot` itself. None, or several, means
ask where SDDs should go, proposing `sdd` beside the repository's other docs.

Then add `sddRoot` to `docRoots`, creating the list if there is none — with any other doc
directories you found on the way. An SDD that cites a ticket draft is an inbound reference
`jira-push-ticket` must rewrite, and it searches only `docRoots`.

Write `sdd.maxLines` as `500` without asking, and say in the one-line report that it is there to
tune. Never leave it out: `doc-check.js` has no default, so that the limit in force is always the
one written in the file. A lower value later splits the files over it; a higher one merges nothing
back, since no path may move.

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
