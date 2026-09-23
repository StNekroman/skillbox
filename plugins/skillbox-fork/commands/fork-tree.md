---
description: Show the fork tree around this session — ancestors above, descendants below.
allowed-tools: Bash(node:*)
argument-hint: "[session-id | search text] [--full]"
---

Show where this conversation sits in its fork tree. Run the script and show its output as-is — it is already formatted:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fork-tree.js" $ARGUMENTS
```

Default focus is the current session; an argument focuses another one (session id, id prefix, or text matched against titles). `--full` widens the view from the ancestor spine to the whole connected tree, including siblings.

Run from a plain shell there is no current session, so it lists every fork tree instead of guessing which one you are in.

Each node is numbered. To open one, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/fork-tree.js" --open <n>` — it launches that session in a new terminal window.

After showing the tree, offer the sessions as a selector with AskUserQuestion so the user can pick one without typing a number: label each option with the short hash and title, and describe it with the turn count and recency. AskUserQuestion allows at most 4 options, so when there are more nodes than that, offer the 4 most useful — prefer live sessions, then the most recent — and say the rest are available by number. Skip the selector entirely if the tree has only one node, or if the user asked merely to look.

On a pick, run `--open <n>` for that node and report the result.

True arrow-key navigation needs a TTY, which a slash command does not have; that requires running `node "${CLAUDE_PLUGIN_ROOT}/scripts/fork-tree.js"` directly in a terminal. Mention that only if the user wants in-place switching rather than a new window.
