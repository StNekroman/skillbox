# skillbox

Personal Claude Code extensions, packaged as plugins. They live here instead of inside any project
repository, so they are available in every project and are never part of a project commit.

The repository is also its own marketplace: `.claude-plugin/marketplace.json` lists what is here,
so a clone can be installed without publishing anywhere.

## What is here

One core plugin and addons. The rule for where a thing goes: anything that needs an MCP server, a
sign-in, or a runtime beyond Node gets its own addon plugin; everything else lives in the core.
Names, descriptions and commands of every installed plugin cost context on every turn, while an
MCP server costs nothing until used — so an addon is a unit someone can decline, not a folder.

| Plugin                                               | What it does                                                                                                                                             | Components                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [**skillbox**](plugins/skillbox/README.md)           | Core. Fork a conversation at a chosen point, navigate the fork tree, draft tickets and ADRs as markdown, keep SDDs true and a knowledge base beside them | 2 commands, 4 skills, 1 hook, [5 scripts](plugins/skillbox/scripts/README.md) |
| [**skillbox-jira**](plugins/skillbox-jira/README.md) | Jira addon. Push a ticket draft to Jira as an issue                                                                                                      | 1 skill, 1 MCP server. Depends on `skillbox`                                  |

Drilling in:

|                                                                                             |                                                                                     |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`skillbox:fork-at`](plugins/skillbox/README.md#fork-at)                                    | Fork the conversation at a chosen turn; the parent is untouched                     |
| [`skillbox:fork-tree`](plugins/skillbox/README.md#fork-tree)                                | Show where this session sits among its forks                                        |
| [`skillbox:draft-ticket`](plugins/skillbox/skills/draft-ticket/README.md)                   | Settled research becomes one ticket file per deliverable                            |
| [`skillbox:to-adr`](plugins/skillbox/skills/to-adr/README.md)                               | A settled architecture decision becomes an ADR; anything less, none                 |
| [`skillbox:to-sdd`](plugins/skillbox/skills/to-sdd/README.md)                               | The SDDs are made true again after a code change, or when one is found wrong        |
| [`skillbox:to-kb`](plugins/skillbox/skills/to-kb/README.md)                                 | Research and outside facts worth keeping become knowledge-base pages, sources cited |
| [`skillbox-jira:jira-push-ticket`](plugins/skillbox-jira/skills/jira-push-ticket/README.md) | A draft becomes a real issue, and the repository is left consistent                 |

**Documentation convention.** A `SKILL.md` or a command's `.md` is written for the model — imperative
instructions. A `README.md` beside it is written for a human reading the repository: what the thing
does, when it fires, what it needs. One exception: nothing but real commands may live in
`commands/`, because every `.md` there registers as a command. A `SKILL.md` never links outside its
own skill folder: what it needs lives beside it, references in `references/` and scripts in
`scripts/`. A skill can be installed on its own — by another agent, or by hand — and a link out of
its folder would then point at nothing. A `README.md` may link anywhere, because it is read here in
the repository.

## Install

Add this repository as a marketplace once, then install the plugins you want. Installing the addon
installs the core with it.

```bash
claude plugin marketplace add StNekroman/skillbox
claude plugin install skillbox@skillbox
claude plugin install skillbox-jira@skillbox
```

A local clone works as a marketplace too, with no git involved — useful while developing:

```bash
claude plugin marketplace add /path/to/your/clone
```

Commands and skills arrive namespaced: `/skillbox:fork-at`, `skillbox:draft-ticket`,
`skillbox:to-adr`, `skillbox:to-sdd`, `skillbox:to-kb`, `skillbox-jira:jira-push-ticket`.

To iterate on a plugin without installing it, load it for a single session:

```bash
claude --plugin-dir /path/to/your/clone/plugins/skillbox
```

### Other agents

The five skills are plain `SKILL.md` folders and carry everything they need, so an agent that reads
that format can use one copied into its skills directory. The commands are Claude Code only: they
drive Claude Code's own sessions. The plugin sets up the Stop hook only in Claude Code, but its
script also speaks the end-of-turn hook formats of Codex, Copilot CLI, Gemini CLI and Cursor, so it
can be wired into those by hand — [to-sdd's README](plugins/skillbox/skills/to-sdd/README.md#the-script-and-the-hook)
says how. Without the hook `to-sdd` and `to-kb` still run their checks themselves; only the
end-of-turn check is missing. `jira-push-ticket` needs the Atlassian MCP server added to that agent by hand.

## Requirements

`skillbox` shells out to Node. Developed against v22; anything with `crypto.randomUUID` will do. Its
doc hook also needs git.

`skillbox-jira` needs the Atlassian MCP server, which it ships itself.
