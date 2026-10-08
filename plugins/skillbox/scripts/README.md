# scripts

The implementation behind `/skillbox:fork-at` and `/skillbox:fork-tree`, and the tests for every
script in the plugin. The command files in `../commands/` invoke the fork scripts through
`${CLAUDE_PLUGIN_ROOT}`.

The doc checker behind the `to-sdd` and `to-kb` skills and both hooks has its one editable
source here, in `doc-check/`, with the references both skills share. Each skill carries identical
copies — the script in its own `scripts/`, the shared references in its `references/` — so that
the skill folder works when it is installed on its own; `npm run sync` writes the copies from the
source, and `npm test` fails while one differs. Edit the source, never a copy. A skill runs its
copy through `${CLAUDE_SKILL_DIR}`; `../hooks/hooks.json` runs the source through
`${CLAUDE_PLUGIN_ROOT}`. The checker requires nothing from outside `doc-check/`.

| File | What |
|---|---|
| `fork-at.js` | Resolves a cut point and opens a window at once; in that window, creates the child with one headless turn and resumes it |
| `fork-tree.js` | Renders the fork tree; interactive picker when run from a TTY |
| `lib/fork-graph.js` | Shared: transcript reading, edge collection, session metadata, terminal launching |
| `doc-check/doc-check.js` | Doc checks and repairs, for SDDs and knowledge-base pages — `check`, `fix`, `migrate`, `lint`, `refs`, `next`, `index` — the Stop hook, `hook`, and the start-of-turn hook, `index-hook`. Disk and git work only |
| `doc-check/lib/doc-model.js` | The doc model, pure: the doc types, parsing a doc, the rules, the mechanical repairs, finding references and links, the content leads, the store index's text |
| `doc-check/references/` | What `to-sdd` and `to-kb` share word for word: the format, the configuration and its init, the agent-instructions block |
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

`doc-model.test.js` covers the doc model directly, including 25 generated docs run through `fix` at
five limits each — split from one file, then merged back at four times the limit and again with
their text cut: every line of text must survive in reading order, nothing `fix` could still
repair may remain, and a second run must change nothing. A doc that fits within two-thirds of the
limit must fold back into `README.md` alone. `doc-check.test.js` runs `doc-check.js` end to end in
throwaway git repositories — as the skill runs it, and as the Stop hook does, with hook input on
stdin. Tests that need git are skipped where it is not installed. `../../../tools/test/` checks
that every skill's copy matches the source, and that the sync tool finds and repairs each kind of
drift.

## The doc checker

`doc-check.js` finds the repository by walking up to `.skillbox/tickets.json`, and reads each doc
type's root and limit from it: `paths.sddRoot` and `sdd.maxLines`, `paths.kbRoot` and
`kb.maxLines`. The split rule, the formats and the reasons behind them are in the
[to-sdd README](../skills/to-sdd/README.md); these matter here.

**One engine, a registry of types.** `TYPES` in `lib/doc-model.js` lists each doc type: its
prefix, its config keys, its noun for messages, whether it still has single-file docs to migrate,
whether `refs` reports the sections that link a changed file, and which of `lint`'s leads apply.
Everything else — the grammar, the layout, the hook — is built from it and shared. Docs are keyed
by their id string, so `SDD001` and `KBDOC001` are two docs. A prefix is capitals only and starts
no other, which the module asserts as it loads, so no reference can be read as another type's.
Every registered prefix is parsed whatever is configured; a reference to a type the config names no
root for is a warning, "not checked", never an error.

| | SDD | KBDOC |
|---|---|---|
| Where | `paths.sddRoot`, `sdd.maxLines` | `paths.kbRoot`, `kb.maxLines` |
| Single-file docs, `migrate` | yes | no |
| A line-number citation | an error | allowed |
| `lint`: history wording, fenced code | yes | no — content on a page about another system |
| `lint`: names in backticks the code lacks | paths, file names, identifiers | paths only — other systems' names are not ours |
| `lint`: labels in titles, links to nothing | yes | yes |
| `refs --changed` reports sections that link a changed file | no | yes |

**`fix` refuses rather than guesses.** A doc with a structural problem — an anchor defined twice, a
section with no parent, an unnumbered heading at section level, text under a pointer — is left
untouched, because moving text around it could misplace some. Everything else it repairs is
mechanical and idempotent.

**The layout is settled one move at a time, by size.** Each step rebuilds the model and takes the
first move that applies: a section out of place goes to the file that holds its parent; a section
file with none below it goes back into its parent's file when the result stays within two-thirds
of the type's limit; the largest inline subsection leaves a file being split. A file starts being
split when it passes the limit and goes on down to two-thirds — or to the limit, when the
section's own text alone is longer than two-thirds. Because a split begins only above the limit
and a merge may fill only to two-thirds, and the merge is measured by building it rather than
estimated, neither can undo the other, and the run ends.

**A section that moves out leaves a pointer.** `moveOut` puts the section's heading, as a link to
its new file, where the section was — `### [§3.2 Retries](3.2.md)` — and a merge puts the text back
in place of its pointer, so a split and a merge are each other's inverse. Before every step the
pointers are made to match the layout: one per section in a file of its own, in the file that holds
its parent, added in anchor order where missing (which is how a doc split before pointers existed
gets them), rewritten when its title or level is stale, and removed where none belongs. They count
towards a file's lines like the index and breadcrumbs. Only a heading that is nothing but a link,
labelled with an anchor, to the file named for that anchor is a pointer, so `fix` never removes a
heading someone wrote. A pointer is not a section: `^#+ §3\.2 ` still finds one heading, references
and links in a pointer are not read, and text under one is a structural problem, since `fix` cannot
know whether it was meant for the section or for its parent.

**Every index entry links its heading.** An entry is `[§3.2 Title](#32-title)` when the section is
in `README.md`, `[§3.2 Title](3.md#32-title)` when it is elsewhere. The id is the one GitHub gives
the heading, and VS Code too, whose markdown preview bundles github-slugger: the heading's rendered
text — a link's label, a code span's content, no emphasis markers, escapes or HTML — lowercased,
stripped of everything but letters, marks, digits, connector punctuation, spaces and hyphens, each
space then a hyphen; a repeat within the file takes `-1`, `-2`. `§3.2 Retries & backoff` becomes
`32-retries--backoff`. github-slugger's character class is a list built from Unicode 13; here it is
`\p{Alphabetic}`, `\p{M}`, `\p{Nd}` and `\p{Pc}`, which agree with it on every character up to
U+0870 and differ only on letters added since. Every heading in the file counts towards the
numbering, a pointer's included. `check` reports an index that differs from the one `fix` writes,
naming the entries that link nothing.

**One grammar for references, shared by `check` and `migrate`.** `findRefs` in `lib/doc-model.js`
reads every way a § can borrow the id before it: a list joined by commas, slashes, dashes, `and`
or `or`, read past a parenthesised label without a § (`SDD005§8.6 (dialog), §8.2`); parentheses
straight after a bare id (`SDD001 (esp. §7)`); a § after a space (`SDD007 §8`). `check` reports
each as a short form, and `migrate`'s `expandRefs` rewrites exactly those, so the two cannot
disagree. Parentheses holding a § after an *anchored* reference are the citing doc's own
(`SDD013§2.2 (§4.9)` in SDD002 cites SDD002's §4.9), and a § after an all-caps name or a number
is another document's (`RFC 6265 §5.3`) — unless the name is a registered id, which claims the §
first (`SDD001 (see KBDOC002 §3)` gives §3 to KBDOC002). A label where the number belongs (`SDD013§P6`) is an
error, not a whole-doc reference; lowercase letters (`§x.y`) are a placeholder and left alone.
The error names the sections whose titles carry the label bare, `(§P6)`, in the doc cited, or
else in every doc of its type that has them: a bare label in SDD002 is usually another SDD's. A section's
title is read for what it cites, like any text; a bare label in a title is where the label is
defined, so `lint` reports it instead, for the content step that comes after the references.

A source file is read for references even when it holds a NUL byte, which git takes for binary:
one in a string literal would otherwise hide the file's citations from `check` and its names from
`lint`. Other files with a NUL are skipped.

**`lint` gives leads, never verdicts.** History wording is a phrase list; a fence with a language
other than a diagram or plain text is copied code. Names in backticks are looked up only when
they have the shape of code — a path with an extension, a dotted member, a call, camelCase,
snake_case. Identifiers are matched as whole words against every text file outside the doc
roots and the docs, read once, so a run costs one pass over the repository however many names there are.
A name found only under a `migrations/` directory is reported as such, since a migration keeps
the names it deletes. A path is matched against the file list: exactly from the root, loosely
(the directories it names, in order) when shorter, and a path git ignores — build output — is
not reported. A relative markdown link is resolved from the file it sits in, a leading `/` from
the repository root, and must name a file, or a directory holding one, exactly — case included,
as wherever else the repository is checked out; one that leaves the repository is reported too.
URLs, in-page anchors, links in code spans or fences, the generated index, breadcrumbs and
pointers, and links into a doc, which `check` reports, are not looked up. It needs no git; without
it the walk supplies the file list.

**Links back.** A knowledge-base page may describe our code without the code citing it. For a type
with `linkBack`, `refs` matches the changed files — or the files given — against what each page
links, by markdown link or by a path in backticks, and lists the section each sits in. The changed
files include a deleted one and a rename's old path, matched against the file list as it was; an
attachment under the knowledge-base root counts, a file inside a doc folder does not. `refs --to`
runs the other way: everything that cites one doc or section, subsections and other spellings
included.

**The reference scan reads only what can cite.** With git, `check`, `fix`, `migrate` and
`refs --to` read the files `git grep` finds a prefix followed by a digit in — tracked or untracked,
ignored ones excluded — plus the docs' own files, so the work grows with the citations, not the repository. Without git, they walk every
file below the root, minus dot-directories and `node_modules`.

**The hook is cheap by construction.** It exits at once without a config or a doc root, then asks
git which files changed since `HEAD` and checks only the doc folders among them, and the references
inside those. It still parses every doc under the roots — numbering and references are validated
against all of them — but reads no file outside them: the repository-wide reference
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

**The store index is rebuilt, never patched.** `index`, `fix`, `migrate` and the start-of-turn
hook all render every index file from the docs as they are and write it only when its text
changed, through a temporary file renamed into place, so a reader never sees half of one. There
is no marker of what changed since the last run: a correct one — the HEAD commit misses
uncommitted edits and a `stash`, a folder's modification time misses edits inside it — costs
nearly what a rebuild does, and the hook pays about 0.1 s to start Node either way. Two types whose
`index.path` is the same share one file. The reference scans skip the index files, whose title
links would read as citations by path, and `check` warns about one git would commit.

**The start-of-turn hook never stands in the way.** `index-hook` reads `cwd` — Cursor's own
`beforeSubmitPrompt`, `workspace_roots` — prints nothing, so it adds nothing to the agent's
context, swallows every failure and exits 0. Cursor's own event gets `{"continue":true}`. Claude
Code runs it in the background (`async`), so the prompt does not wait for it at all.

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

## Sync

`../../../tools/sync-doc-check.js` copies `doc-check/` into every skill that ships it: everything
but `references/` into the skill's `scripts/`, which it owns outright — a file the source no longer
has is deleted there — and `references/<name>.md` into the skill's `references/`, where only those
names are its own. It lives outside `plugins/`, so it never installs. `npm run sync` writes the
copies; `npm run sync:check` lists what is out of date. A skill that needs the checker is added to
its `SKILLS` list. `.gitattributes` marks the copies generated, so a pull request collapses them.

## What they write

`doc-check.js` writes only inside the repository it runs in: for `fix` and `migrate` without
`--dry-run`, doc files — `fix` also deletes the section files it merges back — and, for
`migrate`, the files whose links and references it rewrites; for those two, `index` and the
start-of-turn hook, the index files. It never stages or commits. The Stop hook, `check`, `lint`, `refs` and `next` write nothing.

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
