# skillbox-tickets

Two skills that turn settled research into ticket files, and ticket files into Jira issues.

## Components

| Component                                               | Kind      | What                                                                                                                                                                                    |
| ------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`draft-ticket`](skills/draft-ticket/README.md)         | skill     | Writes one markdown file per deliverable, in a fixed ticket structure, with every claim about the code verified against live code and cited by file and line                            |
| [`jira-push-ticket`](skills/jira-push-ticket/README.md) | skill     | Creates a Jira issue from a draft, turns its relationship sections into real Jira links, rewrites every inbound reference across the repository, and renames the draft to its issue key |
| [`CONFIG.md`](CONFIG.md)                                | reference | The per-repository config contract and its init flow                                                                                                                                    |
| `.mcp.json`                                             | MCP       | The Atlassian server both skills reach Jira through                                                                                                                                     |

They are separate on purpose. `draft-ticket` never touches a tracker; `jira-push-ticket` never
writes a draft.

## Setup

Nothing to do in advance. On first use in a repository the skills look for
`.skillbox/tickets.json` under the repository root, and when it is missing they discover what they
can, ask about what is genuinely a choice, and write it — then carry on with the task you asked
for. Commit the file so your team shares one answer.

`.skillbox/` is where this plugin family keeps its files in a consuming repository, so nothing
lands in the repository root. Derived files go under `.skillbox/cache/`, which is the only path
worth adding to that repository's `.gitignore`.

[The configuration reference](CONFIG.md) has the schema and the init flow. The short version:

```json
{
  "version": 1,
  "jira": {
    "site": "https://example.atlassian.net",
    "projects": ["PROJ"],
    "severityToPriority": {
      "Critical": "Highest",
      "High": "High",
      "Medium": "Medium",
      "Low": "Low"
    }
  },
  "paths": {
    "draftRoot": "devdoc/proposed-tickets",
    "docRoots": ["devdoc/architecture-decisions", "devdoc/specs"]
  },
  "domainNotes": ".github/copilot-instructions.md"
}
```

It holds no secrets — the Atlassian MCP server owns authentication — so it is safe to commit.

Anything Jira can be asked about is **not** in the file: issue types per project, the site's
priority names, and issue link type names are all discovered at the point of use. A site that adds
an issue type, renames a priority or uses different link types needs no edit here.

`jira` may be omitted by a repository that drafts tickets and never pushes them.

## The Atlassian MCP server

`jira-push-ticket` cannot run without it, so this plugin declares it and installing the plugin
brings it along:

```json
{
  "atlassian": {
    "type": "http",
    "url": "https://mcp.atlassian.com/v2/mcp"
  }
}
```

That is `.mcp.json` at the plugin root. Note the shape: a plugin's `.mcp.json` is a bare map of
server name to config, **not** wrapped in `"mcpServers"` the way a repository's own `.mcp.json` is.

Authentication is OAuth, handled by the server on first use — nothing to configure here and no
secret to store. Expect a sign-in prompt the first time a skill reaches Jira.
