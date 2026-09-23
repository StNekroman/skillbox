# Ticket configuration

Both skills in this plugin read one file: `.skillbox/tickets.json`, under the root of the
repository being worked in. It is committed, so a team shares one answer.

`.skillbox/` is the plugin family's own directory in a consuming repository. Everything this
plugin or its siblings need lives there rather than scattered across the repository root.

Everything Jira can be asked about is discovered at run time and never written here. What is
recorded is only what Jira cannot tell you: which site and projects you meant, how your severities
map to its priorities, and where this repository keeps its documents.

## The file

```json
{
  "version": 1,
  "jira": {
    "site": "https://example.atlassian.net",
    "projects": ["PROJ", "OPS"],
    "severityToPriority": {
      "Critical": "Highest",
      "High": "High",
      "Medium": "Medium",
      "Low": "Low"
    }
  },
  "paths": {
    "draftRoot": "devdoc/proposed-tickets",
    "docRoots": ["devdoc/architecture-decisions", "devdoc/specs", "devdoc/tech"]
  },
  "domainNotes": ".github/copilot-instructions.md"
}
```

| Key                       | Meaning                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jira.site`               | Site URL, passed as `cloudId` on every Atlassian MCP call. The tools accept a site URL wherever they accept a site UUID, so no lookup call is needed |
| `jira.projects`           | The project keys this repository pushes to. One entry means never ask; several means ask which                                                       |
| `jira.severityToPriority` | Draft `Severity` to Jira `priority`, by name. Policy, not fact — Jira supplies the available names, you decide which severity means which            |
| `paths.draftRoot`         | Where drafts live, relative to the repository root                                                                                                   |
| `paths.docRoots`          | Directories searched for inbound references to a draft. ADRs, specs, tech docs — whatever this repository has                                        |
| `domainNotes`             | Optional. A repository document holding domain gotchas a drafter must read before writing about them. Omit the key when there is none                |

`jira` may be omitted entirely by a repository that drafts tickets and never pushes them. Then
`draft-ticket` works and `jira-push-ticket` runs its own init when first used.

## Discovered, never configured

Ask Jira at the point of use. None of it belongs in the file, because all of it drifts.

| What                            | How                                                 |
| ------------------------------- | --------------------------------------------------- |
| Issue types a project allows    | `listJiraProjectIssueTypesMetadata` on that project |
| Priority names the site defines | the create metadata for the target project          |
| Issue link type names           | the site's link-type catalogue                      |

A site that renames `Blocks`, disables priorities, or adds an issue type is handled with no edit
here. If a discovery call is unavailable, say so and ask rather than assuming the common defaults.

The plugin declares the Atlassian MCP server itself, in `.mcp.json` at the plugin root, so the
discovery calls are available as soon as the plugin is installed and signed in. If the server is
unreachable, that is the thing to report — not a reason to fall back to defaults.

## When the file is missing

Do not guess, and do not fall back to defaults. Run this, then continue with the task that was
asked — the init is a step inside the work, not a reason to stop and hand it back.

1. **Find the repository root.** `git rev-parse --show-toplevel`. Create `.skillbox/` there if it
   does not exist, and write the file inside it.
2. **Discover the paths.** Look for an existing drafts directory and existing doc directories
   before asking. A repository with `devdoc/proposed-tickets/` already populated has answered
   `draftRoot` itself. Propose what you found; ask only for what you could not.
3. **Discover the Jira side.** If the Atlassian MCP is reachable, list the sites the token reaches
   and the projects on the chosen one. One site and one project means nothing to ask.
4. **Ask only what is genuinely a choice** — which project, and the severity mapping if the site's
   priority names are not the four in the example above.
5. **Write the file**, then say in one line what was written and that it is meant to be committed.

Skip step 3 entirely for `draft-ticket` when no ticket in the conversation carries a Jira key.
Writing a draft does not need a tracker, and asking for one is an interruption.

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
