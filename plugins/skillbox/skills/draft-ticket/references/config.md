# Repository configuration

This skill reads one file: `.skillbox/tickets.json`, under the root of the repository being worked
in. It is committed, so a team shares one answer.

The file is shared. The `draft-ticket`, `to-adr`, `to-sdd`, `to-kb` and `jira-push-ticket` skills
each read it and each fill only the keys they need, so whichever runs first creates it and the
others add to it. Never remove or rewrite a key this skill does not use.

## The keys this skill uses

```json
{
  "version": 1,
  "jira": {
    "site": "https://example.atlassian.net"
  },
  "paths": {
    "draftRoot": "devdoc/proposed-tickets",
    "docRoots": ["devdoc/architecture-decisions", "devdoc/kb", "devdoc/sdd", "devdoc/specs", "devdoc/tech"]
  },
  "domainNotes": ".github/copilot-instructions.md"
}
```

| Key | Meaning |
|---|---|
| `paths.draftRoot` | Where drafts live, relative to the repository root |
| `paths.docRoots` | Directories searched for inbound references to a draft when it is pushed to a tracker. ADRs, specs, tech docs — whatever this repository has. Includes `paths.adrRoot`, `paths.sddRoot` and `paths.kbRoot` whenever they are set |
| `domainNotes` | Optional. A repository document holding domain gotchas a drafter must read before writing about them. Omit the key when there is none |
| `jira.site` | Optional. Site URL, used to write `<site>/browse/<KEY>` links |

The rest of the `jira` block belongs to `jira-push-ticket`. It may be absent in a repository that
drafts tickets and never pushes them.

## When the file or a key is missing

Do not guess, and do not fall back to defaults. Run this, then continue with the task that was
asked — the init is a step inside the work, not a reason to stop and hand it back.

1. **Find the repository root.** `git rev-parse --show-toplevel`. Create `.skillbox/` there if it
   does not exist, and write the file inside it.
2. **Discover before asking.** Each section below says where to look for its keys. Propose what
   you found; ask only for what you could not.
3. **Write the keys**, leaving the rest of the file untouched, then say in one line what was
   written and that it is meant to be committed.

### `paths.draftRoot` and `paths.docRoots`

Look for an existing drafts directory and existing doc directories. A repository with
`devdoc/proposed-tickets/` already populated has answered `draftRoot` itself. When `docRoots` is
already present, keep it and add only what is missing.

### `jira.site`

A file with no `jira` block is complete for drafting; leave it alone. Only when a ticket being
written cites a Jira key, ask for the site URL alone and add it as `jira.site`. Asking before then
is an interruption. Everything else Jira-side — projects, the severity mapping — is
`jira-push-ticket`'s init, run when that skill is first used.

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
