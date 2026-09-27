# Repository configuration

The core plugin's skills read one file: `.skillbox/tickets.json`, under the root of the repository
being worked in. It is committed, so a team shares one answer.

The file is named for the ticket skills, and `to-adr` reads it too. Where ADRs live is one more of
the repository's document paths, and `jira-push-ticket` has to know it to rewrite links inside
them, so one file answers every path question.

`.skillbox/` is the plugin family's own directory in a consuming repository. Everything this
plugin or its siblings need lives there rather than scattered across the repository root.

This plugin owns the `paths` and `domainNotes` keys. The `jira` block belongs to the
`skillbox-jira` plugin, whose own `CONFIG.md` documents it and the init that fills it. It may be
absent in a repository that drafts tickets and never pushes them; `draft-ticket` and `to-adr` use
only `jira.site` from it, to cite an issue by URL.

## The file

```json
{
  "version": 1,
  "jira": {
    "site": "https://example.atlassian.net"
  },
  "paths": {
    "draftRoot": "devdoc/proposed-tickets",
    "adrRoot": "devdoc/architecture-decisions",
    "adrTemplate": "devdoc/architecture-decisions/template.md",
    "docRoots": ["devdoc/architecture-decisions", "devdoc/specs", "devdoc/tech"]
  },
  "domainNotes": ".github/copilot-instructions.md"
}
```

| Key                 | Meaning                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `paths.draftRoot`   | Where drafts live, relative to the repository root. Read by `draft-ticket` and `jira-push-ticket`                                                      |
| `paths.adrRoot`     | Where architecture decision records live, relative to the repository root. Read by `to-adr`                                                            |
| `paths.adrTemplate` | Optional. A markdown file in the repository whose skeleton `to-adr` copies instead of its built-in template. Omit the key to use the built-in          |
| `paths.docRoots`    | Directories searched for inbound references to a draft. ADRs, specs, tech docs — whatever this repository has. Includes `adrRoot` whenever that is set |
| `domainNotes`       | Optional. A repository document holding domain gotchas a drafter must read before writing about them. Omit the key when there is none                  |
| `jira.site`         | Optional here. Site URL, used to write `<site>/browse/<KEY>` links. The rest of the `jira` block is documented by `skillbox-jira`                      |

## When the file or a key is missing

Do not guess, and do not fall back to defaults. Run this, then continue with the task that was
asked — the init is a step inside the work, not a reason to stop and hand it back.

Each skill fills only the keys it needs. `to-adr` does not ask where drafts go, and `draft-ticket`
does not ask where ADRs go; whichever runs second finds the file and adds its own keys.

1. **Find the repository root.** `git rev-parse --show-toplevel`. Create `.skillbox/` there if it
   does not exist, and write the file inside it.
2. **Discover before asking.** Each section below says where to look for its keys. Propose what
   you found; ask only for what you could not.
3. **Write the keys**, leaving the rest of the file untouched, then say in one line what was
   written and that it is meant to be committed.

### `paths.draftRoot` and `paths.docRoots`

Filled by `draft-ticket`. Look for an existing drafts directory and existing doc directories. A
repository with `devdoc/proposed-tickets/` already populated has answered `draftRoot` itself. When
`docRoots` is already present, keep it and add only what is missing.

### `paths.adrRoot` and `paths.adrTemplate`

Filled by `to-adr`. Look for a directory that already holds records: files named like
`ADR-1-*.md`, `adr-001-*.md` or `0001-*.md`, or a directory named `adr`, `adrs`, `decisions` or
`architecture-decisions` — an entry in `docRoots` included. One such directory has answered
`adrRoot` itself. None, or several, means ask where records should go, proposing a directory beside
the repository's other docs.

Then add `adrRoot` to `docRoots`, creating the list if there is none — with any other doc
directories you found on the way. An ADR that cites a draft is an inbound reference
`jira-push-ticket` must rewrite, and it searches only `docRoots`.

For `adrTemplate`, look inside `adrRoot` for a template file: `template.md`, `TEMPLATE.md`,
`adr-template.md`, `0000-template.md`. Propose it when there is one. When there is none, leave the
key out without asking, and mention in the one-line report that the key exists.

### `jira.site`

A file with no `jira` block is complete for drafting and for recording decisions; leave it alone.
Only when something being written cites a Jira key, ask for the site URL alone and add it as
`jira.site`. Asking before then is an interruption. Everything else Jira-side — projects, the
severity mapping — is `skillbox-jira`'s init, run when `jira-push-ticket` is first used.

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
