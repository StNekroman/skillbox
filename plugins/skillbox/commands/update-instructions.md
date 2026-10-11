---
description: Bring the SDD, ADR, glossary and knowledge-base rules in this repository's CLAUDE.md and AGENTS.md up to date with the installed skills.
allowed-tools: Bash(node:*)
argument-hint: "[--dry-run] [file ...]"
---

Run this from the repository root, with the arguments as typed:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/doc-check/doc-check.js" instructions $ARGUMENTS
```

It rewrites the block the `to-sdd`, `to-kb`, `to-adr` and `to-glossary` skills keep in `CLAUDE.md`, `.claude/CLAUDE.md` and `AGENTS.md` wherever a copy differs from the installed one, and adds the block to each file named that has none. `--dry-run` shows the lines that would go and come, and writes nothing.

The output is already visible to the user in the tool result. Add one sentence only when it calls for something:

- **No file holds the block.** Say that the `to-sdd` or `to-kb` init places it, and that naming a file adds it there: `/skillbox:update-instructions AGENTS.md`.
- **A copy is newer than the plugin's.** Say that the plugin is behind and should be updated; the file was left as it is.
- **A missing end marker, or an error.** Relay it.

Otherwise end your turn without writing any text.
