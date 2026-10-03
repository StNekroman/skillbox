---
name: to-sdd
description: Keep the repository’s SDDs — the agent-written memory of how each feature area works — true after a code change. Corrects the sections a change made wrong, adds sections for new architecture, creates an SDD for an area none covers, and keeps each file under the size limit. Writes nothing when the change is below the bar. Use at the end of a task that changed code, or when asked to create, update or migrate SDDs; do not use for ADRs, tickets or code comments.
metadata:
  prompt-version: "2026-10-03.1"
---

# Keep the SDDs true

An SDD is the repository's memory of one feature area: what the area does, how its parts fit, where its state lives, and the rules other code has to follow. Agents write SDDs for agents. The next agent to change that area reads its SDD before touching code, and trusts what it reads.

So a wrong SDD is worse than a missing one. This skill runs at the end of a task that changed code. It makes every statement that the change touched true again, and it records architecture the change added. Most small changes need nothing, and then the skill writes nothing.

## Order of work

1. **See what changed.** Run `git status` and `git diff HEAD`, and take in what the conversation did.
2. **Hold it against `The bar`.** Stop there if nothing clears the bar and none of the changed files cites an SDD. Say so in one line. Do not read the config and do not ask anything.
3. **Read the configuration**, running its init if needed. See `Configuration`.
4. **Find the SDDs the change touches.**
   - Run `refs --changed`. It lists every section the changed code cites, where each section lives, and which lines cite it.
   - For an area the change entered without citing it, list the folders in `paths.sddRoot`. When a folder name is not enough, read the first paragraph of its `README.md`.
5. **Read each affected SDD.** Start with its `README.md`: the abstract, then the index. Every index entry links the file that holds its section. Then read the sections the change touches, and their parents.
6. **Decide what each SDD needs:** corrected statements, new sections, a new SDD, or nothing.
7. **Write it**, following `The format` and `Content`.
8. **Run `fix`, then `check`, then `lint`**, all scoped to the SDDs you wrote. Repair what `check` still reports. Each `lint` warning is a lead: confirm it against the code, and correct the text where it is wrong.
9. **Report.** See `Finish`.

## The bar

An SDD changes when the change does at least one of these:

- **Alters the architecture of a feature or area.** It adds or removes a component, changes how components talk, moves where state lives, changes a flow, or adds a rule other code must follow. That is the level an SDD describes.
- **Makes something an SDD says wrong.** This holds even for a detail that would be below the bar on its own, such as a field, a limit or a name. The detail is already in the SDD, and a wrong statement misleads, so correct it.

These fall below the bar, and the SDDs stay as they are:

- a bug fix that restores what an SDD already describes;
- a refactor inside one module that changes no structure an SDD describes;
- a rename, a reformat, a test, a dependency bump;
- a configuration value, a timeout, a limit;
- a DTO field, an entity field, a detail of a contract — unless an SDD already states it.

Do not add detail below an SDD's level just because the change touched it. An SDD that lists every field goes stale with every change, and then the whole document stops being trusted.

### A new SDD, or a section in an existing one

Keep one SDD per feature area. Create a new SDD only when the change built an area no existing SDD covers. Anything else becomes a section in the SDD that covers the area.

When two SDDs could hold it, choose the one whose abstract names the area, and name the other in the report.

## Configuration

Read `.skillbox/tickets.json` under the repository root. It supplies `paths.sddRoot` and `sdd.maxLines`.

If the file is missing, or has neither key, run the init in [the configuration reference](references/config.md), then carry on. The init writes both keys. The script has no default limit, so the value in force is always the one in the file.

A directory the user names in the request wins for this run. When the init is running anyway, that directory is also the answer to its question.

## First run in a repository

The init leaves two more things to settle. Handle them only in the run where the init ran. After that, `check` reports on the second one, and the report repeats it in one line.

### The agent instructions

An agent reads the SDDs before changing code only when the repository's always-loaded instructions tell it to. Two files at the repository root carry those: `CLAUDE.md`, which Claude Code reads, and `AGENTS.md`, which most other coding agents read. Claude Code reads `AGENTS.md` too, but only while there is no `CLAUDE.md`. Here `CLAUDE.md` means `CLAUDE.md` or `.claude/CLAUDE.md`.

Look for both, then pick where the block goes:

| The repository has | The block goes in |
|---|---|
| A `CLAUDE.md` that imports `@AGENTS.md`, or is a symlink to it | `AGENTS.md`. Every agent reads it from there |
| Only `AGENTS.md` | `AGENTS.md` |
| Only `CLAUDE.md` | `CLAUDE.md` |
| Both, and `CLAUDE.md` does not import `AGENTS.md` | Both. Claude Code reads only `CLAUDE.md` here, and other agents only `AGENTS.md` |
| Neither | A new `AGENTS.md` holding only the block. Claude Code reads it while there is no `CLAUDE.md`, and so do most other agents |

Then, for each file the block goes in:

- **It has no SDD rules.** Propose adding [the instructions block](references/instructions-block.md), with `<sddRoot>` filled in.
- **It already has SDD rules** in an older form. Propose replacing them, and show both the lines that go and the lines that come.

Write only after the user confirms. These files shape every future session in the repository.

### SDDs in the old format

A single-file SDD, `SDDnnn-<slug>.md` directly in `paths.sddRoot`, is the old format. The script counts it for numbering and for references, but does not check it or split it. When there are any, offer the migration once:

1. Run `migrate --dry-run` and summarise what it would do:
   - each file becomes `SDDnnn-<slug>/README.md`, split into section files where it is over the limit;
   - every markdown link to those files, anywhere in the repository, becomes the plain id;
   - every reference in a short or prose form becomes the full form: `SDD006§2.4.1/§12`, `SDD013§4.2 and §5.1`, `SDD007 §8`, `SDD001 (esp. §7)` and "§8.1.2 of SDD006" all come out as `SDDnnn§x.y`, a list joined by commas.
2. Suggest committing first, so the migration is one diff to review.
3. On yes, run `migrate`. It does only the mechanical part: the text is as the old rules left it. Repair the rest in this order.
   1. **References, across the repository**, before any SDD's text changes. Run `check` and repair each reference error. A label cited where a section number belongs, such as `SDD013§P6`, is reported with the headings that carry that label. Pick the section it means, or drop the reference when the sentence around it only tells history. Do this step first: the content step may take the labels out of the headings, and then nothing is left to resolve them by.
   2. **Structure.** A doc that `migrate` moved without splitting had a structural problem. Repair it, then run `fix` on it.
   3. **Content, one SDD at a time.** Run `lint SDDnnn` for the leads, then read the whole SDD and bring it to `Content`. Shorten an abstract over the limit. Delete any note on how to cite or number the doc: the instructions block holds those rules now, and an old note may contradict them. The SDDs are independent of each other, so where you can hand work to subagents, give each SDD its own.
   4. **The agent instructions.** Replace the old SDD rules, as `The agent instructions` describes. `check` may report example ids in the old rules, and replacing them clears those.

Design docs named another way, such as `SDD-001-mail.md` or a `design/` folder, are not SDDs to the script. If the repository has them, ask whether to bring them into the format. That work is manual: rename each file to `SDDnnn-<slug>.md` under `paths.sddRoot`, then migrate.

## The format

### The folder

Each SDD is a folder, `<sddRoot>/SDDnnn-<slug>/`.

- `SDDnnn` comes from `next`. A number is never reused: something may still cite the old one.
- The slug is the title in kebab-case.

A new SDD starts as a single `README.md`:

```markdown
# SDDnnn — <Title>

<The abstract: one paragraph of at most 500 characters. Which area this is, what it covers, which
parts of the system it spans.>

## §1 <First section>
```

After the abstract, the README may hold a few short lines, such as a note on how to cite the doc. Then come the sections. `fix` adds the `## Index` block. Never edit that block by hand.

### Sections

- **A section is a heading that carries its anchor:** `## §3 Title`, `### §3.2 Title`, `#### §3.2.1 Title`. The heading level follows depth, and `fix` sets it.
- **Every anchor is a heading.** It is never a numbered list item or a bold phrase. A reference like `SDD004§3.6.3` has to find a heading, and `check` reports any anchor that has none.
- **Other headings go deeper than their section.** Inside `### §3.2`, an unnumbered heading is `####` or deeper.
- **A title names the approach, not only the topic.** Write "Retries with exponential backoff and a dead-letter queue", not "Retries". The title is what an agent reads in the index to decide whether to open the section.

### Numbers are frozen; text is not

- **Never renumber a section and never reuse a number.** Code and other SDDs cite the numbers.
- **Rewrite a section's text in place** whenever it has stopped being true. Never append "Update: now it does X" under text that says otherwise.
- **A new section takes the next free number among its siblings.** Nest it under a section only when it really belongs inside that section. §3.5.1 means "part of §3.5", never "between §3.5 and §3.6".
- **Removing a section:** keep its heading and delete its text. Its title becomes `(removed)` or `(removed; see §3.6)`. Do the same for each of its subsections. `check` then warns about any code that still cites it.

### Files

`fix` owns the file layout. When a file goes over `sdd.maxLines`, its largest subsections move into files of their own, named for their anchors (`3.md`, `3.2.md`), until the file is within two-thirds of the limit. The small ones stay with their parent. A section file that would fit back into its parent's file, keeping that file within two-thirds of the limit, is merged back. So a section lives in `<anchor>.md`, or else in the file of its nearest parent section that has one.

- **Never create, rename, move or merge a section file by hand.** Never edit a breadcrumb, the first line of a section file.
- **To edit a section,** open the file its index entry links, or search the folder for the heading: `^#+ §3\.2 `.
- **To add a section,** write it at the end of its parent's text, after the parent's last subsection, in the file that holds the parent. For a new top-level section, that is the end of `README.md`. `fix` moves it into a file of its own when the file goes over the limit, and moves it where it belongs if it landed in the wrong file.
- **A section with no subsections can go over the limit,** and `fix` cannot split it. Divide it into nested sections, one heading per part, then run `fix` again.

## References

- **Outside an SDD's own files, write the full form every time:** `SDD006§2.4.1`. In a list, write `SDD006§2.4.1, SDD006§12`, never `SDD006§2.4.1/§12`. Write `SDD006§8.1.2`, never "§8.1.2 of SDD006" or `SDD006 §8.1.2`. A search for `SDD006§12` has to find every line that cites it.
- **Inside an SDD's own files,** a bare `§3.2` means a section of that SDD. Another SDD takes its id every time, `SDD004§1.3`: a bare § right after another SDD's reference, in the same list, is read as that SDD's section. A document outside the repository keeps its own name, `RFC 9110 §15`, and is not checked.
- **A § is followed by a section number.** A label in its place, such as `SDD013§P6` for a project phase, finds no heading.
- **Never cite an SDD by a file path or a markdown link.** The id never moves; a path moves when files split or merge.
- **Cite the section in the code.** When a new section describes code that did not cite an SDD before, add one reference, `SDDnnn§x.y`, in a comment at that code's entry point. That reference is how the next change to that code finds the section. One per entry point is enough; do not cite on every function.
- **Link the ADR behind a design choice** when the repository has one. Put a relative path in the section that describes the choice. Leave the reasons to the ADR and do not restate them.

## Content

- **Check every statement against the live code** in this session, with a grep or a file read. Do not carry a claim over from the chat unchecked.
- **Cite code by path and symbol:** `OffersService.updateOffer` in `apps/api/src/offers/offers.service.ts`. Never cite a line number: lines move with every change, and an SDD is read long after it is written.
- **Current state only.** Never write "previously", "we changed", or "used to". Git holds the history. A section describes the system as it is now.
- **What an SDD holds:**
  - what the area is for and where its edges are;
  - its components and what each one owns;
  - its flows and state;
  - the rules and invariants other code has to follow;
  - the gotchas a newcomer would hit;
  - the reason behind a choice, or a link to the ADR that holds it.
- **What it does not hold:** what the code already says plainly. That means field lists, signatures, copied code and step-by-step walkthroughs of one function.
- **Write for an agent about to change this code.** Use short, dense sentences. Every sentence should be a fact that agent can act on.

## The script

It is `scripts/sdd-check.js` in this skill's folder. Run it from the repository root. In Claude Code, the plugin's Stop hook runs it too.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/sdd-check.js" <command>
```

`${CLAUDE_SKILL_DIR}` is the folder this `SKILL.md` is in. If it reaches you unexpanded, write that folder's absolute path in its place.

| Command | Use it |
|---|---|
| `refs --changed` | Step 4: the sections that changed code cites |
| `next` | Before creating an SDD: the id it takes |
| `fix SDDnnn …` | After writing. It regenerates the index and breadcrumbs, sets heading levels, puts sections where they belong, merges back section files that fit, and moves the largest sections out of files over the limit. It rewrites, creates and deletes files, so read a file again before editing it further |
| `check SDDnnn …` | After `fix`. It runs every rule, including references to those SDDs from anywhere in the repository |
| `lint SDDnnn …` | After `check`. Leads for the `Content` rules, all warnings: wording that tells history, fenced code, and names in backticks that the code no longer has |
| `migrate --dry-run`, `migrate` | First run only: single-file SDDs into folders, and references into the full form |

### After fix and check

`fix` refuses to touch a doc with a structural problem: an anchor defined twice, a section whose parent does not exist, or an unnumbered heading at section level. Repair those by hand first.

`check` then lists what fix cannot repair. The usual cases:

- **An abstract over 500 characters.** Shorten it.
- **A reference to a section that does not exist.** Correct the reference, or add the missing heading. An anchor that exists only as a numbered list item, for example, needs a real heading.
- **A label where a section number belongs.** Cite the section it means, or drop the reference.
- **A line-number citation.** Cite the symbol instead.
- **A section over the limit with no subsections.** Divide it into nested sections, then run `fix` again.

`lint` is not a rule check. History wording is a phrase list, so it also catches some sentences about the present. Fenced code is often copied code, but not always. A name the code lacks may be stale, or may be a library's. Confirm each warning, and change only the text that is wrong.

### The Stop hook

The hook exists only where this skill is installed as part of the Claude Code plugin. There it runs the same rules at the end of every turn, on the SDDs changed since `HEAD`. When it sends the turn back, do what it says: run the `fix` command it prints, or repair the lines it lists.

Without the hook, nothing checks the SDDs after you. Step 8 is then the only check, so never skip it.

## Finish

Report to the user:

- **each SDD touched**, as a clickable link to its `README.md`, with what changed: the sections added, corrected or removed. Put a new SDD first, and mark it as new;
- **what `fix` did**, if it moved sections between files;
- **anything `check` still reports**;
- **what fell below the bar**, one clause each, so a wrong call can be corrected in one line.

When nothing cleared the bar, say that no SDD needed changing, and give the reason in one clause.

Do not paste SDD text into chat. The user will open the file.
