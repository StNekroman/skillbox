# Repository configuration

This skill reads one file: `.skillbox/tickets.json`, under the root of the repository being worked
in. It is committed, so a team shares one answer.

The file is shared. The `draft-ticket`, `to-adr`, `to-sdd` and `jira-push-ticket` skills each read
it and each fill only the keys they need, so whichever runs first creates it and the others add to
it. Never remove or rewrite a key this skill does not use. The file is named for the ticket skills;
where ADRs live is one more of the repository's document paths, and `jira-push-ticket` has to know
them all to rewrite links inside them, so one file answers every path question.

## The keys this skill uses

```json
{
  "version": 1,
  "jira": {
    "site": "https://example.atlassian.net"
  },
  "paths": {
    "adrRoot": "devdoc/architecture-decisions",
    "adrTemplate": "devdoc/architecture-decisions/template.md",
    "docRoots": ["devdoc/architecture-decisions", "devdoc/sdd", "devdoc/specs", "devdoc/tech"]
  }
}
```

| Key | Meaning |
|---|---|
| `paths.adrRoot` | Where architecture decision records live, relative to the repository root |
| `paths.adrTemplate` | Optional. A markdown file in the repository whose skeleton this skill copies instead of its built-in template. Omit the key to use the built-in |
| `paths.docRoots` | Directories searched for inbound references to a ticket draft when it is pushed to a tracker. This skill only adds `adrRoot` to it |
| `jira.site` | Optional. Site URL, used to write `<site>/browse/<KEY>` links |

The rest of the `jira` block belongs to `jira-push-ticket`. It may be absent in a repository that
never pushes tickets.

## When the file or a key is missing

Do not guess, and do not fall back to defaults. Run this, then continue with the task that was
asked — the init is a step inside the work, not a reason to stop and hand it back.

1. **Find the repository root.** `git rev-parse --show-toplevel`. Create `.skillbox/` there if it
   does not exist, and write the file inside it.
2. **Discover before asking.** Each section below says where to look for its keys. Propose what
   you found; ask only for what you could not.
3. **Write the keys**, leaving the rest of the file untouched, then say in one line what was
   written and that it is meant to be committed.

Fill only the keys below. Where ticket drafts go is not this skill's question.

### `paths.adrRoot` and `paths.adrTemplate`

Look for a directory that already holds records: files named like `ADR-1-*.md`, `adr-001-*.md` or
`0001-*.md`, or a directory named `adr`, `adrs`, `decisions` or `architecture-decisions` — an entry
in `docRoots` included. One such directory has answered `adrRoot` itself. None, or several, means
ask where records should go, proposing a directory beside the repository's other docs.

Then add `adrRoot` to `docRoots`, creating the list if there is none — with any other doc
directories you found on the way. An ADR that cites a draft is an inbound reference
`jira-push-ticket` must rewrite, and it searches only `docRoots`.

For `adrTemplate`, look inside `adrRoot` for a template file: `template.md`, `TEMPLATE.md`,
`adr-template.md`, `0000-template.md`. Propose it when there is one. When there is none, leave the
key out without asking, and mention in the one-line report that the key exists.

### `jira.site`

A file with no `jira` block is complete for recording decisions; leave it alone. Only when a record
being written cites a Jira key, ask for the site URL alone and add it as `jira.site`. Asking before
then is an interruption. Everything else Jira-side is `jira-push-ticket`'s init, run when that
skill is first used.

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
