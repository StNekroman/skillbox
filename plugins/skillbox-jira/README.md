# skillbox-jira

The Jira addon: one skill that turns a ticket draft into a Jira issue, and the Atlassian MCP server
it needs. Drafts themselves are written by the [skillbox](../skillbox/README.md) core plugin, which
this one depends on and pulls in when installed.

## Components

| Component                                               | Kind      | What                                                                                                                                                                                    |
| ------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`jira-push-ticket`](skills/jira-push-ticket/README.md) | skill     | Creates a Jira issue from a draft, turns its relationship sections into real Jira links, rewrites every inbound reference across the repository, and renames the draft to its issue key |
| `.mcp.json`                                             | MCP       | The Atlassian server the skill reaches Jira through                                                                                                                                     |

`jira-push-ticket` never writes a draft; `draft-ticket` in the core never touches a tracker. They
are separate plugins on purpose: this one brings an MCP server and a sign-in prompt, and someone who
only drafts should not have to carry either.

## Setup

Nothing to do in advance. On first use in a repository the skill looks for the `jira` block in
`.skillbox/tickets.json` under the repository root, and when it is missing it discovers what it
can from Jira, asks about what is genuinely a choice, and writes it — then carries on with the task
you asked for. The file is shared with the core plugin's ticket skill; commit it so your team
shares one answer.

[The skill's configuration reference](skills/jira-push-ticket/references/config.md) has the
block's schema and the init flow. The short version:

```json
{
  "jira": {
    "site": "https://example.atlassian.net",
    "projects": ["PROJ"],
    "severityToPriority": {
      "Critical": "Highest",
      "High": "High",
      "Medium": "Medium",
      "Low": "Low"
    }
  }
}
```

It holds no secrets — the Atlassian MCP server owns authentication — so it is safe to commit.

Anything Jira can be asked about is **not** in the file: issue types per project, the site's
priority names, and issue link type names are all discovered at the point of use. A site that adds
an issue type, renames a priority or uses different link types needs no edit here.

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

That is `.mcp.json` at the plugin root.

Authentication is OAuth, handled by the server on first use — nothing to configure here and no
secret to store. Expect a sign-in prompt the first time the skill reaches Jira.
