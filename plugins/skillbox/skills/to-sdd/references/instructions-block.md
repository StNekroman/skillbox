<!-- The block to-sdd proposes for a repository's always-loaded agent instructions: CLAUDE.md,
AGENTS.md, or both. Replace <sddRoot> with paths.sddRoot, drop this comment, and write everything
below it. The examples use letters, not digits, so the reference checker never mistakes them for
real references. -->

## SDDs

`<sddRoot>/` holds this repository's SDDs: one folder per feature area, `SDDnnn-<slug>/`, written
by agents for agents. They record how each area works and why.

- **Before you change code in an area, read its SDD.** List the folders in `<sddRoot>/`. When a
  folder name is not enough, read the first paragraph of its `README.md`. Read the whole
  `README.md` first: its index lists every section and links the file that holds it. Then read
  the sections the change touches.
- **Code cites a section as `SDDnnn§x.y`.** To find one, search `<sddRoot>/SDDnnn-*/` for the
  heading that starts with `§x.y `.
- **When a task that changed code is done, invoke the `to-sdd` skill.** It decides
  whether an SDD has to change, and makes the change. Edit SDD files only through it.
- **Cite a section in the full form, every time:** `SDDnnn§a.b, SDDnnn§c`, never `SDDnnn§a.b/§c`,
  and never by a file path.
