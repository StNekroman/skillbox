# skillbox

Personal Claude Code extensions, packaged as plugins. They live here instead of inside any project
repository, so they are available in every project and are never part of a project commit.

The repository is also its own marketplace: `.claude-plugin/marketplace.json` lists what is here,
so a clone can be installed without publishing anywhere.

## What is here

| Plugin                                                     | What it does                                                          | Components                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [**skillbox-fork**](plugins/skillbox-fork/README.md)       | Fork a conversation at a chosen point and navigate the resulting tree | 2 commands, [3 scripts](plugins/skillbox-fork/scripts/README.md) |
| [**skillbox-tickets**](plugins/skillbox-tickets/README.md) | Draft tickets as markdown, then push them to Jira as issues           | 2 skills, 1 MCP server                                           |

Drilling in:

|                                                                                                   |                                                                     |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [`skillbox-fork:fork-at`](plugins/skillbox-fork/README.md#fork-at)                                | Fork the conversation at a chosen turn; the parent is untouched     |
| [`skillbox-fork:fork-tree`](plugins/skillbox-fork/README.md#fork-tree)                            | Show where this session sits among its forks                        |
| [`skillbox-tickets:draft-ticket`](plugins/skillbox-tickets/skills/draft-ticket/README.md)         | Settled research becomes one ticket file per deliverable            |
| [`skillbox-tickets:jira-push-ticket`](plugins/skillbox-tickets/skills/jira-push-ticket/README.md) | A draft becomes a real issue, and the repository is left consistent |

**Documentation convention.** A `SKILL.md` or a command's `.md` is written for the model — imperative
instructions. A `README.md` beside it is written for a human reading the repository: what the thing
does, when it fires, what it needs. One exception: nothing but real commands may live in
`commands/`, because every `.md` there registers as a command.

## Install

Add this repository as a marketplace once, then install the plugins you want.

```bash
claude plugin marketplace add StNekroman/skillbox
claude plugin install skillbox-fork@skillbox
claude plugin install skillbox-tickets@skillbox
```

A local clone works as a marketplace too, with no git involved — useful while developing:

```bash
claude plugin marketplace add /path/to/your/clone
```

Commands and skills arrive namespaced: `/skillbox-fork:fork-at`, `skillbox-tickets:draft-ticket`.

To iterate on a plugin without installing it, load it for a single session:

```bash
claude --plugin-dir /path/to/your/clone/plugins/skillbox-fork
```

## Requirements

`skillbox-fork` shells out to Node. Developed against v22; anything with `crypto.randomUUID` will do.

`skillbox-tickets` needs the Atlassian MCP server, which it ships itself.
