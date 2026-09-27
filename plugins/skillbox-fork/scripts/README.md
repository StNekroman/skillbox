# scripts

The implementation behind `/skillbox-fork:fork-at` and `/skillbox-fork:fork-tree`. The command
files in `../commands/` are thin wrappers that invoke these through `${CLAUDE_PLUGIN_ROOT}`.

| File | What |
|---|---|
| `fork-at.js` | Resolves a cut point and opens a window at once; in that window, creates the child with one headless turn and resumes it |
| `fork-tree.js` | Renders the fork tree; interactive picker when run from a TTY |
| `lib/fork-graph.js` | Shared: transcript reading, edge collection, session metadata, terminal launching |
| `test/` | Unit and end-to-end tests, run with Node's built-in runner |

Run them directly for things a slash command cannot do — `fork-tree.js` from a real terminal gets
arrow-key navigation and switches session in place, which needs a TTY:

```bash
node fork-tree.js
node fork-at.js --dry-run "some phrase"
```

A real run prints a single line — which turn, which child, where it went — because it stays in the
parent's history once per fork. `--dry-run` prints the full plan instead: both commands the window
would run, and the child's first prompt, without creating anything. `--no-open` creates the fork in the current process and prints the resume
command instead of opening a window.

## How a fork is made

Two stages, so the window opens straight away instead of after a model turn.

1. **In the parent.** `fork-at.js` resolves the cut, writes a hand-off file to
   `fork-pending/<child>.json`, opens a window running `fork-at.js --finish <that file>`, and exits.
2. **In the window.** The finishing stage reads and deletes the hand-off, runs the headless
   `claude -p` turn that creates the child, writes the ledger, then starts `claude --resume <child>`
   interactively — with the directive, if there is one, as your first message.

The hand-off carries everything the window needs, because a window cannot be trusted to inherit it:
Terminal.app, iTerm and gnome-terminal start from a fresh environment in your home directory. So the
config directory, the resolved binary and the project directory all travel in the file, and the
window changes into the project directory itself — a session resumed from the wrong directory is
looked up in the wrong project.

The headless turn only ever carries the idle prompt. A directive never runs unattended.

## Tests

No dependencies — Node's built-in runner. From the repository root:

```bash
node --test 'plugins/skillbox-fork/scripts/test/*.test.js'
```

Every test builds synthetic transcripts in a throwaway `CLAUDE_CONFIG_DIR`, so none reads your real
sessions. `cli.test.js` runs the scripts as the slash commands do, end to end, against
`test/fixtures/fake-claude.js` — a stand-in binary that records its arguments, stdin, working
directory and config directory. `FORK_AT_TERMINAL='{cmd}'` runs the window's command as a hidden
background process, so no window opens and no model is called.

The scripts are importable for this reason: `main()` runs only under `require.main === module`, and a
failure throws `CliError` instead of exiting, which `runMain` turns into the printed error.

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

In the config directory, all additive and safe to delete:

- `fork-tree.jsonl` — one line per fork: parent, child, cut point.
- `fork-tree-cache.json` — size/mtime cache so the tree does not reparse every transcript.
- `fork-pending/` — hand-off files between the two stages of a fork, each deleted when its window
  picks it up. One left behind means a window that never started.

Transcripts themselves are only ever read.
