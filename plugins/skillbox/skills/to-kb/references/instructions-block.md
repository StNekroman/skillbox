<!-- block-version: 2026-10-11.1. Bump it with every change to the block below: a repository whose
copy is older is then told to update it, and one whose copy is newer is left alone.

The block to-sdd and to-kb keep in a repository's always-loaded agent instructions, and to-adr
and to-glossary bring up to date: CLAUDE.md, AGENTS.md, or both. `doc-check.js instructions`
writes it there between two markers, without this comment, filling in <sddRoot> and <kbRoot> from
paths.sddRoot and paths.kbRoot, and <sddIndex> and <kbIndex> from sdd.index.path and
kb.index.path. The ADRs are optional: <adrRoot> and <adrIndex> come from paths.adrRoot and
adr.index.path, and the lines between an "if adrIndex" comment line and its "end if" stand only
when the config has both; the lines after its "else", only when it has not. The glossary is
optional too: <glossary> comes from paths.glossary, and the "if glossary" lines stand only when
the config has it. The examples use letters, not digits, so the reference checker never mistakes
them for real references. -->

<!-- if adrIndex -->
<!-- if glossary -->
## SDDs, ADRs, the glossary and the knowledge base
<!-- else -->
## SDDs, ADRs and the knowledge base
<!-- end if -->
<!-- else -->
<!-- if glossary -->
## SDDs, the glossary and the knowledge base
<!-- else -->
## SDDs and the knowledge base
<!-- end if -->
<!-- end if -->

This repository keeps two stores of docs written by agents for agents, one folder per subject:

- `<sddRoot>/SDDnnn-<slug>/` — **SDDs**: how this repository's code works, one per feature area or
  shared mechanism, and why.
- `<kbRoot>/KBDOCnnn-<slug>/` — **the knowledge base**: what we know about the world the product
  lives in: outside services and their rules, legal requirements, research, know-how.
<!-- if adrIndex -->

Beside them, `<adrRoot>/` holds the **ADRs**: one file per architecture decision, with the
alternatives weighed and why they lost.
<!-- end if -->
<!-- if glossary -->

`<glossary>` is the **glossary**: the one name this project uses for each concept of its domain,
what the name means, and the words not to use for it.
<!-- end if -->

- **Before you change code in an area, read its SDD.** Find it in `<sddIndex>`, which lists every
  SDD with its summary. The file is generated and git-ignored: when it is missing, list the
  folders in `<sddRoot>/` and read the first paragraph of each `README.md` instead. Read the SDD's
  whole `README.md` first: its index lists every section and links the file that holds it. Then
  read the sections the change touches, and the sections of other SDDs they cite.
- **Before you work with an outside service, a rule or a topic the knowledge base may cover, read
  `<kbIndex>`** and the page that covers it, the same way.
<!-- if adrIndex -->
- **Before you make a design choice other code will have to follow, read `<adrIndex>`:** where a
  kind of data lives, how services talk, what a component may depend on. It lists every ADR with
  its status, and each title names the decision. The file is generated and git-ignored: when it is
  missing, list `<adrRoot>/` instead. Follow the accepted records that bear on the choice; a
  superseded one only tells what was decided before. When the task needs what an accepted record
  rules out, ask the user before you go against it: reopening a decision is theirs to do, and
  `to-adr` records the new one. Never edit an accepted record.
<!-- end if -->
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
<!-- if glossary -->
- **Before you write or discuss anything about the product's domain, read `<glossary>`**: a spec,
  a ticket, a design, a doc, a name in code, or a reply that proposes one of these. Once a session
  is enough. When the file is missing, no term is settled yet.
- **Call each concept by its glossary term**, in replies, docs and new code, and never by a word
  its entry lists under `_Avoid_`. Never give a concept a second name. Existing code may still use
  an avoided word: quote its identifiers as they are, and name the concept by its term.
- **When you need a name for a domain concept the glossary lacks, propose one and ask before you
  use it.** A word you coin and keep using becomes the project's term without anyone choosing it.
- **When the user says a word the glossary avoids, or uses a term in another sense, say so and ask
  which they mean** before you go on, once per word. Their answer settles it.
- **When the user settles a term** — picks one of two words, renames or narrows a term, or names a
  new concept and keeps the name — invoke the `to-glossary` skill when the task is done, or
  sooner, before a ticket, a spec or a doc uses the term. Edit `<glossary>` only through
  `to-glossary`.
<!-- end if -->
