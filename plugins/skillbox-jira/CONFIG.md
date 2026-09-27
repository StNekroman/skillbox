# Jira configuration

`jira-push-ticket` reads the `jira` block of `.skillbox/tickets.json`, the file the `skillbox`
core plugin's ticket skills share. Where the file lives, the `paths` keys and the init that
creates the file are documented in that plugin's `CONFIG.md`. This document covers the `jira`
block only.

Everything Jira can be asked about is discovered at run time and never written here. What is
recorded is only what Jira cannot tell you: which site and projects you meant, and how your
severities map to its priorities.

## The block

```json
{
  "jira": {
    "site": "https://example.atlassian.net",
    "projects": ["PROJ", "OPS"],
    "severityToPriority": {
      "Critical": "Highest",
      "High": "High",
      "Medium": "Medium",
      "Low": "Low"
    }
  }
}
```

| Key                       | Meaning                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jira.site`               | Site URL, passed as `cloudId` on every Atlassian MCP call. The tools accept a site URL wherever they accept a site UUID, so no lookup call is needed |
| `jira.projects`           | The project keys this repository pushes to. One entry means never ask; several means ask which                                                       |
| `jira.severityToPriority` | Draft `Severity` to Jira `priority`, by name. Policy, not fact — Jira supplies the available names, you decide which severity means which            |

The skill also needs `paths.draftRoot` and `paths.docRoots` from the core-owned part of the same
file: where the drafts are, and which directories to search for inbound references.

It holds no secrets — the Atlassian MCP server owns authentication — so it is safe to commit.

## Discovered, never configured

Ask Jira at the point of use. None of it belongs in the file, because all of it drifts.

| What                            | How                                                 |
| ------------------------------- | --------------------------------------------------- |
| Issue types a project allows    | `listJiraProjectIssueTypesMetadata` on that project |
| Priority names the site defines | the create metadata for the target project          |
| Issue link type names           | the site's link-type catalogue                      |

A site that renames `Blocks`, disables priorities, or adds an issue type is handled with no edit
here. If a discovery call is unavailable, say so and ask rather than assuming the common defaults.

This plugin declares the Atlassian MCP server itself, in `.mcp.json` at the plugin root, so the
discovery calls are available as soon as the plugin is installed and signed in. If the server is
unreachable, that is the thing to report — not a reason to fall back to defaults.

## When the `jira` block is missing

Do not guess, and do not fall back to defaults. Run this, then continue with the task that was
asked — the init is a step inside the work, not a reason to stop and hand it back.

1. **Find the file.** `git rev-parse --show-toplevel`, then `.skillbox/tickets.json` under it. If
   the whole file is missing, discover the `paths` keys the way the core plugin's init does —
   look for an existing drafts directory and existing doc directories before asking — and write
   both halves at once.
2. **Discover the Jira side.** List the sites the token reaches and the projects on the chosen
   one. One site and one project means nothing to ask.
3. **Ask only what is genuinely a choice** — which project, and the severity mapping if the site's
   priority names are not the four in the example above.
4. **Write the block** into the file, leaving the rest of it untouched, then say in one line what
   was written and that it is meant to be committed.

A `jira.site` already present with nothing beside it is the trace of `draft-ticket` citing an
issue before any push. Keep it and fill in the rest.
