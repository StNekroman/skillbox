# scripts

The implementation behind `/skillbox-fork:fork-at` and `/skillbox-fork:fork-tree`. The command
files in `../commands/` are thin wrappers that invoke these through `${CLAUDE_PLUGIN_ROOT}`.

| File | What |
|---|---|
| `fork-at.js` | Resolves a cut point, then launches one headless turn over the kept history to create the child session |
| `fork-tree.js` | Renders the fork tree; interactive picker when run from a TTY |
| `lib/fork-graph.js` | Shared: transcript reading, edge collection, session metadata, terminal launching |

Run them directly for things a slash command cannot do — `fork-tree.js` from a real terminal gets
arrow-key navigation and switches session in place, which needs a TTY:

```bash
node fork-tree.js
node fork-at.js --dry-run "some phrase"
```

`--dry-run` prints the `claude` invocation and the child's first prompt without creating anything.

## Environment

| Variable | Effect |
|---|---|
| `CLAUDE_CONFIG_DIR` | Where transcripts are read from. Defaults to `~/.claude` |
| `CLAUDE_CODE_EXECPATH` | The `claude` binary to launch. Defaults to `claude` on PATH |
| `CLAUDE_CODE_SESSION_ID` | Set by Claude Code. `fork-at` refuses to run without it |
| `FORK_AT_TERMINAL` | Command template for opening a window; `{cmd}` is substituted |
| `NO_COLOR` | Disables colour in `fork-tree` |

## Two conventions in here

**Spawn with the resolved binary, print the bare name.** A window we launch inherits no PATH
guarantee, so it gets `CLAUDE_CODE_EXECPATH`. A command printed for you to type later resolves
against your own PATH, and an absolute path recorded now can go stale. `resumeCommand()` in
`lib/fork-graph.js` builds the first; the printed strings stay plain `claude`.

**A launched session must not look nested.** `cleanEnv()` strips the variables Claude Code sets for
its children. The important one is `CLAUDE_CODE_CHILD_SESSION`: a session that sees it stops writing
its transcript, which would silently make the fork unresumable.

## Version coupling

These read Claude Code's own session store and drive its CLI, so they depend on internals that carry
no compatibility promise:

- **Two undocumented flags**, `--resume-session-at` and `--resume-drops-turn`. Both work; neither
  appears in `claude --help`.
- **Private transcript fields** — `origin.kind`, `forkedFrom`, the `ai-title` and `last-prompt` row
  types, and `~/.claude/sessions/*.json` for liveness.

A Claude Code upgrade is the likeliest thing to break this.

## What they write

Two files in the config directory, both additive and safe to delete:

- `fork-tree.jsonl` — one line per fork: parent, child, cut point.
- `fork-tree-cache.json` — size/mtime cache so the tree does not reparse every transcript.

Transcripts themselves are only ever read.
