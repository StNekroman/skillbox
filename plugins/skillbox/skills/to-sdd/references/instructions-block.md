<!-- block-version: 2026-10-10.1. Bump it with every change to the block below: a repository whose
copy is older is then told to update it, and one whose copy is newer is left alone.

The block to-sdd and to-kb keep in a repository's always-loaded agent instructions: CLAUDE.md,
AGENTS.md, or both. `doc-check.js instructions` writes it there between two markers, without this
comment, filling in <sddRoot> and <kbRoot> from paths.sddRoot and paths.kbRoot, and <sddIndex> and
<kbIndex> from sdd.index.path and kb.index.path. The examples use letters, not digits, so the
reference checker never mistakes them for real references. -->

## SDDs and the knowledge base

This repository keeps two stores of docs written by agents for agents, one folder per subject:

- `<sddRoot>/SDDnnn-<slug>/` — **SDDs**: how this repository's code works, one per feature area or
  shared mechanism, and why.
- `<kbRoot>/KBDOCnnn-<slug>/` — **the knowledge base**: what we know about the world the product
  lives in: outside services and their rules, legal requirements, research, know-how.

- **Before you change code in an area, read its SDD.** Find it in `<sddIndex>`, which lists every
  SDD with its summary. The file is generated and git-ignored: when it is missing, list the
  folders in `<sddRoot>/` and read the first paragraph of each `README.md` instead. Read the SDD's
  whole `README.md` first: its index lists every section and links the file that holds it. Then
  read the sections the change touches, and the sections of other SDDs they cite.
- **Before you work with an outside service, a rule or a topic the knowledge base may cover, read
  `<kbIndex>`** and the page that covers it, the same way.
- **To find a rule or a fact no summary names, search the section headings** of the whole store:
  each names its approach, so `^#+ §[0-9.]+ .*(word|synonym)` finds sections in docs you would not
  have opened.
- **A section is cited as `SDDnnn§x.y` or `KBDOCnnn§x.y`**, in code and in docs. To find one,
  search that store's `SDDnnn-*/` or `KBDOCnnn-*/` folder for the heading that starts with `§x.y `.
- **When a task that changed code is done, invoke the `to-sdd` skill.** It decides whether an SDD
  has to change, and makes the change.
- **When the code contradicts an SDD you read, note it, and invoke `to-sdd` when the task is
  done**, even if the task changed no code. It corrects the SDD without asking, except a rule the
  code breaks: that may be a bug, so it reports it instead.
- **When you had to work out how an area works, and no SDD holds what you found, ask the user
  when the task is done whether to record it; on yes, invoke `to-sdd`.** What you found may be a
  flow, a rule or a gotcha. Ask about what you worked out, not about every file no SDD covers.
- **When a task found out something about the outside world that the next agent could not quickly
  look up or already know, ask the user once, when the task is done, whether to add it to the
  knowledge base; on yes, invoke the `to-kb` skill.** It qualifies when you observed it and the
  docs leave it out or say otherwise, when a person or an outside party told us, or when it is
  research that took real work to put together. What a service's own docs state, what any agent
  already knows, and what you recall without a source checked in this session do not. When in
  doubt, do not ask. A no holds for the rest of the conversation. The user may also ask for it
  directly.
- **Edit SDDs only through `to-sdd`, and knowledge-base pages only through `to-kb`.**
- **Cite a section in the full form, every time:** `SDDnnn§a.b, SDDnnn§c`, never `SDDnnn§a.b/§c`,
  and never by a file path.
