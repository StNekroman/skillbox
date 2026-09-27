---
description: Fork the current conversation into a new session, truncated at a chosen point.
allowed-tools: Bash(node:*)
argument-hint: "<@id | N | search text> [-- <directive for the child>]"
---

Run this, passing the arguments as one single-quoted string exactly as typed, `--` included. Write each `'` inside them as `'\''`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fork-at.js" '$ARGUMENTS'
```

The output is already visible to the user in the tool result. On success it is a single line: do not repeat it, summarise it or add to it — end your turn without writing any text.

On a non-zero exit, never retry with different search text yourself.

If the error lists candidate turns — an ambiguous match, or no match — let the user pick with AskUserQuestion rather than asking in text. One question, header `Fork point`, asking "Fork after which turn? Everything before it is kept too." The list runs oldest to newest: keep that order, one option per candidate, and when there are more than 4, offer the last 4. Label each `Turn N: <gist>` with N from its `turn N of M`; describe it with its `@id`, where it matched, and its indented second line, which is what tells identical prompts apart. The user may instead type an `@id`, a turn number from the list, or new search text. Then run the script once more with the chosen turn's `@id` as the selector — or the new text — keeping any `-- directive` exactly as first typed, and follow these same rules for its output.

Any other error: relay it in one sentence.
