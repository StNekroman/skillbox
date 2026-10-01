# Repository configuration

This skill reads one file: `.skillbox/tickets.json`, under the root of the repository being worked
in. It is committed, so a team shares one answer. It holds no secrets — the Atlassian MCP server
owns authentication — so it is safe to commit.

The file is shared. The `draft-ticket`, `to-adr`, `to-sdd` and `jira-push-ticket` skills each read
it and each fill only the keys they need, so whichever runs first creates it and the others add to
it. Never remove or rewrite a key this skill does not use.

Everything Jira can be asked about is discovered at run time and never written here. What is
recorded is only what Jira cannot tell you: which site and projects you meant, and how your
severities map to its priorities.

## The keys this skill uses

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
    "docRoots": ["devdoc/architecture-decisions", "devdoc/sdd", "devdoc/specs", "devdoc/tech"]
  }
}
```

| Key | Meaning |
|---|---|
| `jira.site` | Site URL, passed as `cloudId` on every Atlassian MCP call. The tools accept a site URL wherever they accept a site UUID, so no lookup call is needed |
| `jira.projects` | The project keys this repository pushes to. One entry means never ask; several means ask which |
| `jira.severityToPriority` | Draft `Severity` to Jira `priority`, by name. Policy, not fact — Jira supplies the available names, you decide which severity means which |
| `paths.draftRoot` | Where drafts live, relative to the repository root |
| `paths.docRoots` | Directories searched for inbound references to a draft: ADRs, specs, tech docs — whatever this repository has. Where references cluster, not where they are allowed to be |

The `paths` keys are written by the skills that draft tickets and record decisions. This skill
reads them, and fills them only when the file has none.

## Discovered, never configured

Ask Jira at the point of use. None of it belongs in the file, because all of it drifts.

| What | How |
|---|---|
| Issue types a project allows | `listJiraProjectIssueTypesMetadata` on that project |
| Priority names the site defines | the create metadata for the target project |
| Issue link type names | the site's link-type catalogue |

A site that renames `Blocks`, disables priorities, or adds an issue type is handled with no edit
here. If a discovery call is unavailable, say so and ask rather than assuming the common defaults.

If the Atlassian MCP server is unreachable, that is the thing to report — not a reason to fall back
to defaults.

## When the file or a key is missing

Do not guess, and do not fall back to defaults. Run this, then continue with the task that was
asked — the init is a step inside the work, not a reason to stop and hand it back.

1. **Find the file.** `git rev-parse --show-toplevel`, then `.skillbox/tickets.json` under it.
   Create `.skillbox/` and the file if they do not exist.
2. **Discover the `paths` side, if it is missing.** Look for an existing drafts directory and
   existing doc directories before asking. A repository with `devdoc/proposed-tickets/` already
   populated has answered `draftRoot` itself. When `docRoots` is already present, keep it.
3. **Discover the Jira side.** List the sites the token reaches and the projects on the chosen
   one. One site and one project means nothing to ask.
4. **Ask only what is genuinely a choice** — which project, and the severity mapping if the site's
   priority names are not the four in the example above.
5. **Write the keys** into the file, leaving the rest of it untouched, then say in one line what
   was written and that it is meant to be committed.

A `jira.site` already present with nothing beside it is the trace of a draft or a decision record
citing an issue before any push. Keep it and fill in the rest.

When this step creates `.skillbox/`, suggest ignoring `.skillbox/cache/` — the one path under it
for anything derived or per-developer — rather than `.skillbox/` wholesale, which would drop the
configuration the team is meant to share.
