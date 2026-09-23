# skillbox-fork

Fork a Claude Code conversation into a new session truncated at a chosen point, and navigate the
resulting tree.

## Components

| Component                       | Kind    | What                                            |
| ------------------------------- | ------- | ----------------------------------------------- |
| `/skillbox-fork:fork-at`        | command | Fork the conversation at a chosen turn          |
| `/skillbox-fork:fork-tree`      | command | Show where this session sits among its forks    |
| [`scripts/`](scripts/README.md) | node    | The implementation, plus env vars and internals |

Commands are documented here rather than beside their files: every `.md` in `commands/` registers
as a command, so a README in there would appear as a stray `/readme`.

## fork-at

```
/skillbox-fork:fork-at <@id | N | search text> [-- <directive for the child>]
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

Anything after `--` becomes the child's first instruction, so that turn does real work instead of
being spent on a summary. With no directive the child acknowledges and waits.

`fork-at` and `fork-tree` turns are never selectable and never counted — they are machinery, and
counting them would both pollute text search and shift every number.

## fork-tree

```
/skillbox-fork:fork-tree [session-id | search text] [--full]
```

Default focus is the current session; an argument focuses another one. `--full` widens the view from
the ancestor spine to the whole connected tree, including siblings.

Run from a plain shell there is no current session, so it lists every fork tree instead of guessing.
Run in a real terminal it gets arrow-key navigation and can switch session in place — that needs a
TTY, which a slash command does not have.

## Requirements

Node. Developed against v22; anything with `crypto.randomUUID` will do.

This drives Claude Code's own session store and CLI, including two undocumented flags. See
[scripts/README.md](scripts/README.md#version-coupling) for what an upgrade might break.
