# skillbox

The core of the family: everything here needs nothing beyond Node. Fork a Claude Code conversation
into a new session truncated at a chosen point and navigate the resulting tree; write settled
research into ticket draft files, settled architecture decisions into ADRs, and keep the
repository's SDDs true as the code changes.

## Components

| Component                                       | Kind      | What                                                                                            |
| ----------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `/skillbox:fork-at`                             | command   | Fork the conversation at a chosen turn                                                          |
| `/skillbox:fork-tree`                           | command   | Show where this session sits among its forks                                                    |
| [`draft-ticket`](skills/draft-ticket/README.md) | skill     | Writes one markdown file per deliverable, in a fixed ticket structure, every claim verified     |
| [`to-adr`](skills/to-adr/README.md)             | skill     | Records a settled architecture decision as an ADR — and writes nothing when there is none       |
| [`to-sdd`](skills/to-sdd/README.md)             | skill     | After a code change, corrects or extends the SDDs it touched — and writes nothing below the bar |
| `hooks/hooks.json`                              | hook      | Stop hook: checks the SDDs changed in a turn before the turn ends                               |
| [`scripts/`](scripts/README.md)                 | node      | The fork implementation and the tests of every script, plus env vars and internals              |

Commands are documented here rather than beside their files: every `.md` in `commands/` registers
as a command, so a README in there would appear as a stray `/readme`.

`draft-ticket` never touches a tracker. Turning a draft into a Jira issue is the
[skillbox-jira](../skillbox-jira/README.md) addon's job, and the separation is deliberate: that
plugin needs an MCP server and a sign-in, this one does not.

## fork-at

```
/skillbox:fork-at <@id | N | search text> [-- <directive for the child>]
```

The child keeps history up to and including the matched exchange; the parent is left untouched. A
match anywhere in a turn cuts at the **end** of that turn, so a tool call is never split.

Selecting the cut:

| Selector | Means                                                                     |
| -------- | ------------------------------------------------------------------------- |
| `@id`    | A turn id as printed by the lists. Stable — always the same turn          |
| a number | Drop that many turns from the end. Shifts as the conversation grows       |
| text     | The turn containing it, matched against both your prompts and the answers |
| empty    | Keep the whole conversation                                               |

Text matching folds markdown and typography on both sides, so a phrase copied from the rendered
chat still matches the source it came from — backticks, bold markers, curly quotes, long dashes and
line wrapping are all ignored. Ambiguous text is never resolved by guessing: the script lists the
candidates and exits.

The child opens in a new window straight away; the fork is created inside it, which takes a few
seconds, and the window then becomes the child session, in the parent's project directory.

The child is named `Fork: <your search text>` — or `Fork: <the matched prompt>` when you selected
by `@id`, by number or with nothing — so it stands out in `claude --resume`'s picker and in the
fork tree.

Anything after `--` is sent as your first message once the child is open, so it runs where you can
see it and approve what it does — never unattended. With no directive the child opens idle and
waits.

`fork-at` and `fork-tree` turns are never selectable and never counted — they are machinery, and
counting them would both pollute text search and shift every number.

## fork-tree

```
/skillbox:fork-tree [session-id | search text] [--all] [--full]
```

Default focus is the current session; an argument focuses another one. `--all` widens the view from
the ancestor spine to the whole connected tree, including siblings. `--full` prints whole session ids
in place of the 8-character hash — `/resume` inside a session takes only a whole id or an exact name,
so this is the form to paste there.

Run from a plain shell there is no current session, so it lists every fork tree instead of guessing.
Run in a real terminal it gets arrow-key navigation and can switch session in place — that needs a
TTY, which a slash command does not have. Picking the session you are already in opens nothing; it
just says so.

A session whose project directory has since been deleted or moved is tagged `dir missing` and is not
opened: Claude Code looks a session up from the directory it was started in. The error names that
directory, and the transcript folder to move if the project has relocated.

## draft-ticket

Settled research becomes one ticket file per deliverable, under the drafts directory named in the
repository's `.skillbox/tickets.json`. On first use in a repository the skill discovers what it can,
asks about what is genuinely a choice, and writes that file — then carries on with the task you
asked for. Commit the file so your team shares one answer.

[Configuration](#configuration) maps the file;
[the skill's README](skills/draft-ticket/README.md) has what it produces and the rule that matters
most.

## to-adr

A decision the conversation settled becomes an architecture decision record under the ADR
directory named in the same `.skillbox/tickets.json`: the decision, the alternatives weighed and
why each lost, and what it costs. Most conversations settle nothing that deserves one, and then the
skill writes nothing and says why — an ADR directory stays useful only while every record in it
matters.

On first use it finds the ADR directory the repository already has, or asks where records should
go. `paths.adrTemplate` points it at the repository's own ADR template instead of its built-in one.
[The skill's README](skills/to-adr/README.md) has the bar a decision must clear and what it never
invents.

## to-sdd

An SDD is agent-written memory of one feature area, committed to the repository: what the area
does, how its parts fit, the rules other code follows. The next agent reads it before changing that
area. At the end of a task that changed code, the skill corrects what the change made wrong and
records the architecture it added — and writes nothing for a bug fix, a refactor or a field.

Each SDD is a folder, `SDDnnn-<slug>/`, whose `README.md` holds the abstract and a generated index.
When a file passes `sdd.maxLines`, its largest subsections move into files named for their anchors,
and a section file that fits back into its parent's is merged back, so the agent always reads whole
files instead of grepping a long one. References are ids, `SDD001§3.2`, never paths, so nothing
breaks when files split or merge.

The plugin's Stop hook checks the SDDs changed in a turn before the turn ends, and sends problems
back to the agent. The plugin sets it up in Claude Code; other agents can have it wired in by hand.
It does nothing in a repository whose config names no `paths.sddRoot`, and on first use the skill
proposes the `CLAUDE.md` or `AGENTS.md` lines that make sessions read and update SDDs at all. [The skill's README](skills/to-sdd/README.md) has the format, the bar and the
script, which ships inside the skill folder.

## Configuration

The skills read one committed file, `.skillbox/tickets.json` at the root of the repository they
work in, and fill in the keys they need on first use: they discover what they can and ask about the
rest. Each skill carries the part it reads in its own `references/config.md`, so it works when
installed on its own. The whole file:

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
    "adrRoot": "devdoc/architecture-decisions",
    "adrTemplate": "devdoc/architecture-decisions/template.md",
    "sddRoot": "devdoc/sdd",
    "docRoots": ["devdoc/architecture-decisions", "devdoc/sdd", "devdoc/specs", "devdoc/tech"]
  },
  "sdd": {
    "maxLines": 500
  },
  "domainNotes": ".github/copilot-instructions.md"
}
```

| Key                                        | Filled by                                             | Read by                                      |
| ------------------------------------------ | ----------------------------------------------------- | -------------------------------------------- |
| `paths.draftRoot`                          | `draft-ticket`                                        | `draft-ticket`, `jira-push-ticket`           |
| `paths.adrRoot`, `paths.adrTemplate`       | `to-adr`                                              | `to-adr`                                     |
| `paths.sddRoot`, `sdd.maxLines`            | `to-sdd`                                              | `to-sdd`, its script, the Stop hook          |
| `paths.docRoots`                           | `draft-ticket`; `to-adr` and `to-sdd` add their roots | `jira-push-ticket`                           |
| `domainNotes`                              | you, by hand                                          | `draft-ticket`                               |
| `jira.site`                                | whichever skill first cites or pushes an issue        | `draft-ticket`, `to-adr`, `jira-push-ticket` |
| `jira.projects`, `jira.severityToPriority` | `jira-push-ticket`                                    | `jira-push-ticket`                           |

What each key means, and the init that fills it, is in the skill's own reference:
[draft-ticket](skills/draft-ticket/references/config.md), [to-adr](skills/to-adr/references/config.md),
[to-sdd](skills/to-sdd/references/config.md), and
[jira-push-ticket](../skillbox-jira/skills/jira-push-ticket/references/config.md) in the addon.
Commit the file. Ignore only `.skillbox/cache/`, the place for anything derived or per-developer.

## Requirements

Node. Developed against v22; anything with `crypto.randomUUID` will do. The SDD hook and
`sdd-check.js refs --changed` also need git.

The fork commands drive Claude Code's own session store and CLI, including two undocumented flags.
See [scripts/README.md](scripts/README.md#version-coupling) for what an upgrade might break.
