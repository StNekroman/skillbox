# scripts

The implementation behind `/skillbox:fork-at` and `/skillbox:fork-tree`, and the tests for every
script in the plugin. The command files in `../commands/` invoke the fork scripts through
`${CLAUDE_PLUGIN_ROOT}`.

The doc checker behind the `to-sdd` skill and the Stop hook has its one editable source here, in
`doc-check/`. Each skill that runs it carries an identical copy in its own `scripts/`, so that the
skill folder works when it is installed on its own; `npm run sync` writes the copies from the
source, and `npm test` fails while one differs. Edit the source, never a copy. A skill runs its
copy through `${CLAUDE_SKILL_DIR}`; `../hooks/hooks.json` runs the source through
`${CLAUDE_PLUGIN_ROOT}`. The checker requires nothing from outside `doc-check/`.

| File | What |
|---|---|
| `fork-at.js` | Resolves a cut point and opens a window at once; in that window, creates the child with one headless turn and resumes it |
| `fork-tree.js` | Renders the fork tree; interactive picker when run from a TTY |
| `lib/fork-graph.js` | Shared: transcript reading, edge collection, session metadata, terminal launching |
| `doc-check/doc-check.js` | SDD checks and repairs — `check`, `fix`, `migrate`, `lint`, `refs`, `next` — and the Stop hook, `hook`. Disk and git work only |
| `doc-check/lib/doc-model.js` | The SDD model, pure: parsing a doc, the rules, the mechanical repairs, finding references, the content leads |
| `test/` | Unit and end-to-end tests for all of the above, run with Node's built-in runner |

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
   `claude -p` turn that creates the child, retags the child's transcript, writes the ledger, then
   starts `claude --resume <child>` interactively — with the directive, if there is one, as your
   first message.

The retag is needed because only `-p` honours the cut, and `-p` tags every row it writes
`"entrypoint":"sdk-cli"`, the copied parent history included. Claude Code treats a session tagged
that way as a headless SDK run: it leaves it out of the `/resume` picker and never resolves its name,
so the child would answer only to its full id. Neither `CLAUDE_CODE_ENTRYPOINT` nor any flag changes
the tag in print mode, so `fork-at.js` rewrites each row's own field to `"cli"`, which is what an
interactive fork writes. Nothing else writes the file between the `-p` call exiting and the resume.
If the retag fails, the fork still works and a note says to resume it by its full id.

The hand-off carries everything the window needs, because a window cannot be trusted to inherit it:
Terminal.app, iTerm and gnome-terminal start from a fresh environment in your home directory. So the
config directory, the resolved binary and the project directory all travel in the file, and the
window changes into the project directory itself — a session resumed from the wrong directory is
looked up in the wrong project. A project directory that no longer exists stops either stage with an
error naming it, and the transcript folder to move if the project has relocated, rather than a
window that opens only to report the session not found.

The headless turn only ever carries the idle prompt. A directive never runs unattended.

## Tests

No dependencies — Node's built-in runner, 21 or later. From the repository root:

```bash
npm test            # everything
npm run test:fork   # fork-at, fork-tree and their CLI
npm run test:doc    # the doc checker, and that the skills' copies match it
```

The root `package.json` holds only these scripts; nothing needs installing. Each runs
`node --test` on a glob, which Node expands itself, so they behave the same in any shell.

Every fork test builds synthetic transcripts in a throwaway `CLAUDE_CONFIG_DIR`, so none reads your real
sessions. `cli.test.js` runs the scripts as the slash commands do, end to end, against
`test/fixtures/fake-claude.js` — a stand-in binary that records its arguments, stdin, working
directory and config directory. `FORK_AT_TERMINAL='{cmd}'` runs the window's command as a hidden
background process, so no window opens and no model is called.

The scripts are importable for this reason: `main()` runs only under `require.main === module`, and a
failure throws `CliError` instead of exiting, which `runMain` turns into the printed error.

`doc-model.test.js` covers the SDD model directly, including 25 generated docs run through `fix` at
five limits each — split from one file, then merged back at four times the limit and again with
their text cut: every line of text must survive in reading order, nothing `fix` could still
repair may remain, and a second run must change nothing. A doc that fits within two-thirds of the
limit must fold back into `README.md` alone. `doc-check.test.js` runs `doc-check.js` end to end in
throwaway git repositories — as the skill runs it, and as the Stop hook does, with hook input on
stdin. Tests that need git are skipped where it is not installed.

## The SDD checker

`doc-check.js` finds the repository by walking up to `.skillbox/tickets.json`, and reads
`paths.sddRoot` and `sdd.maxLines` from it. The split rule, the formats and the reasons behind them
are in the [to-sdd README](../skills/to-sdd/README.md); these matter here.

**`fix` refuses rather than guesses.** A doc with a structural problem — an anchor defined twice, a
section with no parent, an unnumbered heading at section level — is left untouched, because moving
text around it could misplace some. Everything else it repairs is mechanical and idempotent.

**The layout is settled one move at a time, by size.** Each step rebuilds the model and takes the
first move that applies: a section out of place goes to the file that holds its parent; a section
file with none below it goes back into its parent's file when the result stays within two-thirds
of `sdd.maxLines`; the largest inline subsection leaves a file being split. A file starts being
split when it passes the limit and goes on down to two-thirds — or to the limit, when the
section's own text alone is longer than two-thirds. Because a split begins only above the limit
and a merge may fill only to two-thirds, and the merge is measured by building it rather than
estimated, neither can undo the other, and the run ends.

**One grammar for references, shared by `check` and `migrate`.** `findRefs` in `lib/doc-model.js`
reads every way a § can borrow the id before it: a list joined by commas, slashes, dashes, `and`
or `or`, read past a parenthesised label without a § (`SDD005§8.6 (dialog), §8.2`); parentheses
straight after a bare id (`SDD001 (esp. §7)`); a § after a space (`SDD007 §8`). `check` reports
each as a short form, and `migrate`'s `expandRefs` rewrites exactly those, so the two cannot
disagree. Parentheses holding a § after an *anchored* reference are the citing doc's own
(`SDD013§2.2 (§4.9)` in SDD002 cites SDD002's §4.9), and a § after an all-caps name or a number
is another document's (`RFC 6265 §5.3`). A label where the number belongs (`SDD013§P6`) is an
error, not a whole-doc reference; lowercase letters (`§x.y`) are a placeholder and left alone.
The error names the sections whose titles carry the label bare, `(§P6)`, in the doc cited, or
else in every SDD that has them: a bare label in SDD002 is usually another doc's. A section's
title is read for what it cites, like any text; a bare label in a title is where the label is
defined, so `lint` reports it instead, for the content step that comes after the references.

A source file is read for references even when it holds a NUL byte, which git takes for binary:
one in a string literal would otherwise hide the file's citations from `check` and its names from
`lint`. Other files with a NUL are skipped.

**`lint` gives leads, never verdicts.** History wording is a phrase list; a fence with a language
other than a diagram or plain text is copied code. Names in backticks are looked up only when
they have the shape of code — a path with an extension, a dotted member, a call, camelCase,
snake_case. Identifiers are matched as whole words against every text file outside the SDDs and
the docs, read once, so a run costs one pass over the repository however many names there are.
A name found only under a `migrations/` directory is reported as such, since a migration keeps
the names it deletes. A path is matched against the file list: exactly from the root, loosely
(the directories it names, in order) when shorter, and a path git ignores — build output — is
not reported. It needs no git; without it the walk supplies the file list.

**The reference scan reads only what can cite.** With git, `check`, `fix` and `migrate` read the
files `git grep` finds `SDD` in — tracked or untracked, ignored ones excluded — plus the SDD files
themselves, so the work grows with the citations, not the repository. Without git, they walk every
file below the root, minus dot-directories and `node_modules`.

**The hook is cheap by construction.** It exits at once without a config or a `paths.sddRoot`, then
asks git which files changed since `HEAD` and checks only the SDD folders among them, and the
references inside those. It still parses every SDD under `paths.sddRoot` — numbering and references
are validated against all of them — but reads no file outside it: the repository-wide reference
scan is `check`'s job, run by the skill, not something to pay for at the end of every turn. It
sends the turn back only on an error, and never when it was already sent back once:
`stop_hook_active`, or Cursor's `loop_count`.

**One reply for most agents.** The hook reads `cwd` and `stop_hook_active` on stdin. To send the
turn back it prints `{"decision":"block","reason":…}` and exits 0. That is the end-of-turn shape
Claude Code, Codex and Copilot CLI document on `Stop` (Copilot also on `agentStop`), and Gemini
CLI on `AfterAgent`; Cursor accepts it from a hook in Claude Code's format. Cursor's own `stop`
hook gets its own answer: the repository from `workspace_roots`, the reply as `followup_message`.
The hook never exits 2: Copilot documents only the JSON reply for a stop, and Cursor's own `stop`
ignores the exit code. The tests feed each documented input shape; only Claude Code runs it for
real.

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
- **Private transcript fields** — `origin.kind`, `forkedFrom`, the `custom-title`, `ai-title` and
  `last-prompt` row types, and `~/.claude/sessions/*.json` for liveness.
- **How `/resume` hides headless sessions** — by the `entrypoint` tag on the transcript rows, which
  is why the child is retagged. Both flags above work only with `-p`; interactive mode ignores them.

A Claude Code upgrade is the likeliest thing to break this.

## What they write

`doc-check.js` writes only inside the repository it runs in, and only for `fix` and `migrate`
without `--dry-run`: SDD files — `fix` also deletes the section files it merges back — and, for
`migrate`, the files whose links and references it rewrites. It never stages or commits. The hook, `check`, `lint`, `refs` and `next` write nothing.

The fork scripts write in the config directory. Apart from the child's own transcript, whose
`entrypoint` tags `fork-at.js` rewrites once after creating it, everything is additive and safe to
delete:

- `fork-tree.jsonl` — one line per fork: parent, child, cut point.
- `fork-tree-cache.json` — size/mtime cache so the tree does not reparse every transcript. Entries
  for transcripts that no longer exist are dropped each time it is saved.
- `fork-pending/` — hand-off files between the two stages of a fork, each deleted when its window
  picks it up. One left behind means a window that never started; both scripts sweep anything older
  than ten minutes as they start.

Transcripts themselves are only ever read.
