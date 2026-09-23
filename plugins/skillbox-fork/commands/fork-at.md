---
description: Fork the current conversation into a new session, truncated at a chosen point.
allowed-tools: Bash(node:*)
argument-hint: "<search text | N> [-- <directive for the child>]"
---

Fork this conversation into a new session. The child keeps history up to and including the matched exchange; this session is left untouched.

Run the script and show its output to the user as-is — it is already formatted:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fork-at.js" $ARGUMENTS
```

Selector, taken from `$ARGUMENTS` before any `--`:

- `@id` — a turn id as printed by the lists. Stable: it always means the same turn. Prefer this when relaying a choice back to the user.
- a number — drop that many turns from the end. Counts back from the end, so it shifts as the conversation grows.
- text — the turn containing it, case-insensitive. Both your prompts and the answers are searched, so you can name something the assistant said. Matching ignores markdown and typography, so a phrase copied from the rendered chat still matches the source it came from: backticks, bold/italic markers, curly quotes, long dashes and line wrapping are all folded away on both sides. If more than one turn matches, the script lists them and exits rather than guessing; relay that list and let the user pick.
- empty — keep the whole conversation

`/fork-at` and `/fork-tree` turns are never selectable and never counted. They are machinery, and counting them would both pollute text search and shift every number.

A match anywhere in a turn cuts at the end of that turn, so the whole exchange is kept and a tool call is never split.

Anything after `--` becomes the child's first instruction, and the forked session answers it — so that turn does real work instead of being spent on a summary.

With no directive the child is told only that it was forked and that no task has been given yet, so it acknowledges and waits. Suggest a directive when the user clearly knows what the fork is for; do not add one yourself, since a fork usually exists because the plan is still being decided.

If the script exits non-zero, relay its error and stop. The no-match error lists candidate turns with offsets — tell the user to retry with one of those numbers rather than guessing different search text.

On success, confirm in one line: the child session id, that it is open in a new window, and that this session is unchanged.
