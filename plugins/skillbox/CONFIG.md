# Ticket configuration

The ticket skills read one file: `.skillbox/tickets.json`, under the root of the repository being
worked in. It is committed, so a team shares one answer.

`.skillbox/` is the plugin family's own directory in a consuming repository. Everything this
plugin or its siblings need lives there rather than scattered across the repository root.

This plugin owns the `paths` and `domainNotes` keys. The `jira` block belongs to the
`skillbox-jira` plugin, whose own `CONFIG.md` documents it and the init that fills it. It may be
absent in a repository that drafts tickets and never pushes them; `draft-ticket` uses only
`jira.site` from it, to cite an issue by URL.

## The file

```json
{
  "version": 1,
  "jira": {
    "site": "https://example.atlassian.net"
  },
  "paths": {
    "draftRoot": "devdoc/proposed-tickets",
    "docRoots": ["devdoc/architecture-decisions", "devdoc/specs", "devdoc/tech"]
  },
  "domainNotes": ".github/copilot-instructions.md"
}
```

| Key               | Meaning                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `paths.draftRoot` | Where drafts live, relative to the repository root                                                                                    |
| `paths.docRoots`  | Directories searched for inbound references to a draft. ADRs, specs, tech docs — whatever this repository has                         |
| `domainNotes`     | Optional. A repository document holding domain gotchas a drafter must read before writing about them. Omit the key when there is none |
| `jira.site`       | Optional here. Site URL, used to write `<site>/browse/<KEY>` links. The rest of the `jira` block is documented by `skillbox-jira`      |

## When the file is missing

Do not guess, and do not fall back to defaults. Run this, then continue with the task that was
asked — the init is a step inside the work, not a reason to stop and hand it back.

1. **Find the repository root.** `git rev-parse --show-toplevel`. Create `.skillbox/` there if it
   does not exist, and write the file inside it.
2. **Discover the paths.** Look for an existing drafts directory and existing doc directories
   before asking. A repository with `devdoc/proposed-tickets/` already populated has answered
   `draftRoot` itself. Propose what you found; ask only for what you could not.
3. **Ask about a Jira site only if a ticket in the conversation carries a Jira key.** Writing a
   draft does not need a tracker, and asking for one is an interruption. When a key is in play,
   ask for the site URL alone and write it as `jira.site`. Everything else Jira-side — projects,
   the severity mapping — is `skillbox-jira`'s init, run when `jira-push-ticket` is first used.
4. **Write the file**, then say in one line what was written and that it is meant to be committed.

## What else lives in `.skillbox/`

Committed, because the team shares it:

| Path                     | What               |
| ------------------------ | ------------------ |
| `.skillbox/tickets.json` | this configuration |

Not committed. Anything derived, per-developer or regenerable goes under `.skillbox/cache/`, and
the consuming repository should ignore that one path:

```gitignore
.skillbox/cache/
```

Nothing here holds a secret, so nothing else needs ignoring. Suggest that line when writing the
config into a repository that has no `.skillbox/` yet, rather than ignoring `.skillbox/` wholesale
— that would drop the configuration the team is meant to share.
