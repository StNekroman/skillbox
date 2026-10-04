<!-- The block to-sdd and to-kb propose for a repository's always-loaded agent instructions:
CLAUDE.md, AGENTS.md, or both. Replace <sddRoot> with paths.sddRoot and <kbRoot> with paths.kbRoot,
drop this comment, and write everything below it. The examples use letters, not digits, so the
reference checker never mistakes them for real references. -->

## SDDs and the knowledge base

This repository keeps two stores of docs written by agents for agents, one folder per subject:

- `<sddRoot>/SDDnnn-<slug>/` — **SDDs**: how this repository's code works, one per feature area or
  shared mechanism, and why.
- `<kbRoot>/KBDOCnnn-<slug>/` — **the knowledge base**: what we know about the world the product
  lives in: outside services and their rules, legal requirements, research, know-how.

- **Before you change code in an area, read its SDD.** List the folders in `<sddRoot>/`. When a
  folder name is not enough, read the first paragraph of its `README.md`. Read the whole
  `README.md` first: its index lists every section and links the file that holds it. Then read
  the sections the change touches, and the sections of other SDDs they cite.
- **Before you work with an outside service, a rule or a topic the knowledge base may cover, list
  `<kbRoot>/`** and read the page that covers it, the same way.
- **A section is cited as `SDDnnn§x.y` or `KBDOCnnn§x.y`**, in code and in docs. To find one,
  search that store's `SDDnnn-*/` or `KBDOCnnn-*/` folder for the heading that starts with `§x.y `.
- **When a task that changed code is done, invoke the `to-sdd` skill.** It decides whether an SDD
  has to change, and makes the change.
- **When a task turned up research or facts about the outside world worth keeping, ask the user
  whether to add them to the knowledge base; on yes, invoke the `to-kb` skill.** The user may also
  ask for it directly.
- **Edit SDDs only through `to-sdd`, and knowledge-base pages only through `to-kb`.**
- **Cite a section in the full form, every time:** `SDDnnn§a.b, SDDnnn§c`, never `SDDnnn§a.b/§c`,
  and never by a file path.
