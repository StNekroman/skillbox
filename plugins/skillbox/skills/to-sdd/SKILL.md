---
name: to-sdd
description: Keep the repository’s SDDs — the agent-written memory of how each feature area and each shared mechanism works — true. Corrects the sections a code change made wrong or a task found the code contradicts, adds sections for new architecture, creates an SDD for an area none covers, and keeps each file under the size limit. Writes nothing when the change is below the bar. Use at the end of a task that changed code, that found an SDD statement the code contradicts, or that worked out how an area works and the user agreed to record it; or when asked to create, update or migrate SDDs; do not use for knowledge-base pages, ADRs, tickets or code comments.
metadata:
  prompt-version: "2026-10-04.4"
---

# Keep the SDDs true

An SDD is the repository's memory of one area: a feature, or a mechanism several features rely on, such as tenant isolation, authorization or the event bus. It holds what the area does, how its parts fit, where its state lives, and the rules other code has to follow. Agents write SDDs for agents. The next agent to change that area reads its SDD before touching code, and trusts what it reads.

So a wrong SDD is worse than a missing one. This skill runs at the end of a task that changed code, that found an SDD statement the code contradicts, or that worked out how an area works and the user agreed to record it. It makes every statement that the change touched true again, corrects what the task found wrong, and records architecture the change added or the task worked out. Most small changes need nothing, and then the skill writes nothing.

SDDs sit beside the repository's knowledge base: pages about the world outside the code, `KBDOCnnn`, which the `to-kb` skill keeps. This skill never edits those pages.

## Order of work

1. **Gather what the task brought.** A run may have any of these:
   - **The change.** Run `git status` and `git diff HEAD`, and take in what the conversation did.
   - **Statements found wrong.** SDD statements the conversation found the code contradicts. See `Found wrong in passing`.
   - **What the task worked out.** An area, flow, rule or gotcha the conversation had to work out, which no SDD holds. If the user has not been asked whether to record it, ask now. See `Worked out, not written down`.
   - **An area to document**, because the request names one or the user agreed to record one. Its code is the change: read it in place of the diff, and go on to step 3.
2. **Hold it against `The bar`.** Stop there if nothing clears the bar and none of the changed files cites an SDD. Say so in one line. Do not read the config and do not ask anything more.
3. **Read the configuration**, running its init if needed. See `Configuration`.
4. **Find the SDDs the change touches.**
   - Run `refs --changed`. It lists every section the changed code cites, where each section lives, and which lines cite it. It also lists the knowledge-base sections that link a changed file: keep those for the report, and leave the pages alone.
   - For an area the change entered without citing it, list the folders in `paths.sddRoot`. When a folder name is not enough, read the first paragraph of its `README.md`.
   - For a rule the change makes code follow, grep `paths.sddRoot` for the names of the mechanism behind it. Another SDD may already hold the rule. See `A rule several areas follow`.
5. **Read each affected SDD.** Start with its `README.md`: the summary, then the index. Every index entry links its section's heading, in the file that holds it: `#<id>` in `README.md` itself, `<file>#<id>` elsewhere. Then read the sections the change touches, and their parents. For each section you will correct or remove, run `refs --to` on it: a section of another SDD that cites it may need the same correction.
6. **Decide what each SDD needs:** corrected statements, new sections, a new SDD, or nothing.
7. **Write it**, following [the format](references/format.md) and `Content`. Read the format before you write.
8. **Run `fix`, then `check`, then `lint`**, all scoped to the SDDs you wrote. Repair what `check` still reports. Each `lint` warning is a lead: confirm it against the code, and correct the text where it is wrong.
9. **Report.** See `Finish`.

## The bar

An SDD changes when the task does at least one of these:

- **Alters the architecture of a feature or area.** It adds or removes a component, changes how components talk, moves where state lives, changes a flow, or adds a rule other code must follow. That is the level an SDD describes.
- **Makes something an SDD says wrong.** This holds even for a detail that would be below the bar on its own, such as a field, a limit or a name. The detail is already in the SDD, and a wrong statement misleads, so correct it.
- **Finds something an SDD says wrong or stale**, with or without a change, whatever made it wrong. A detail below the bar counts here too. See `Found wrong in passing`.
- **Works out an area, flow, rule or gotcha no SDD holds**, and the user agrees to record it. See `Worked out, not written down`.

These fall below the bar, and the SDDs stay as they are:

- a bug fix that restores what an SDD already describes;
- a refactor inside one module that changes no structure an SDD describes;
- a rename, a reformat, a test, a dependency bump;
- a configuration value, a timeout, a limit;
- a DTO field, an entity field, a detail of a contract — unless an SDD already states it.

Do not add detail below an SDD's level just because the change touched it. An SDD that lists every field goes stale with every change, and then the whole document stops being trusted.

### Found wrong in passing

An agent reading an SDD may find a statement the code contradicts, in a section its task never touched. Correct it without asking: the next agent trusts that statement.

- **Confirm it first.** Read all the code the statement is about: every implementation, every branch behind a flag. A statement that is wrong for the path the task saw may be true for another. Correct only what the code contradicts outright.
- **Then decide which side is wrong.** A statement that describes the code, such as what a component owns, where state lives, the order of a flow or a name, follows the code: rewrite it. A rule other code must follow is different. Code that breaks it may be the bug, and rewriting the rule would turn that bug into the documented behaviour. Leave such a rule as it is and report the breach. Rewrite it only once the user says the rule no longer holds.

### Worked out, not written down

A task that had to work out how an area works has paid for knowledge no SDD holds. Record it only on the user's yes: it adds text someone has to keep true. The agent instructions have the agent ask when the task is done. When this run finds such knowledge the user was not asked about, ask before writing it.

- **Ask about what the task learned, not what it touched.** Code no SDD covers is common, and touching it is no reason to ask. Working out something at the level of `The bar` is.
- **On yes, document the area, not the investigation.** The task saw one path through the code, and an SDD written from that path reads as complete. Read the area's code as when asked to document it, then write. A rule or gotcha in an area an SDD already covers becomes a section in that SDD; read the code around it the same way.
- **A no holds for the rest of the conversation.** Do not ask about that area again.

### A new SDD, or a section in an existing one

Keep one SDD per area. Create a new SDD when the change built an area no existing SDD covers, when the user asked for or agreed to record such an area, or when the change made a second area rely on a mechanism that so far lives in another area's SDD: see `A rule several areas follow`. Anything else becomes a section in the SDD that covers the area.

When two SDDs could hold it, choose the one whose summary names the area, and name the other in the report. A rule several areas follow goes in the SDD of the mechanism that enforces it.

### A rule several areas follow

Some rules hold in many areas: every query is scoped by tenant, every handler sits behind the auth guard. State such a rule once, in the SDD of the mechanism that enforces it. Every other SDD says how its own area applies the rule, and cites that section, `SDDnnn§x.y`. Never restate it: when the rule changes, `refs --changed` finds the section that the mechanism's code cites, and a copy in another SDD stays wrong.

- **A rule starts where it was built.** While only one area follows it, it stays a section of that area's SDD.
- **When a second area comes to rely on it, move it into an SDD of its own**, named for the mechanism, so that the folder listing leads the next agent to it.
  1. Take the id from `next SDD`, and write the section and its subsections in the new SDD.
  2. Remove the old section as [the format](references/format.md) says, titled `(removed; see SDDnnn§x.y)` with its new id, and each of its subsections the same way.
  3. Run `refs --to` on the old section, and repoint every citation it lists, in code and in other SDDs. `check` warns until none is left.
  4. If the mechanism's entry point in the code cited nothing, add the citation. Without it, `refs --changed` never reaches the new SDD.
- **Only a mechanism gets an SDD of its own:** code that enforces the rule, such as a guard, a base class, a middleware or a shared module. A convention no code enforces, such as a naming or style rule, belongs in the repository's agent instructions or a lint rule, not in an SDD.

## Configuration

Read `.skillbox/tickets.json` under the repository root. It supplies `paths.sddRoot` and `sdd.maxLines`, and `paths.kbRoot` and `kb.maxLines` for the knowledge base.

If the file is missing, or lacks any of those four keys, run the init in [the configuration reference](references/config.md), then carry on. The init writes the missing keys, and in the same run settles the repository's agent instructions, which name both stores. The script has no default limit, so the value in force is always the one in the file.

A directory the user names in the request wins for this run. When the init is running anyway, that directory is also the answer to its question.

## SDDs in the old format

A single-file SDD, `SDDnnn-<slug>.md` directly in `paths.sddRoot`, is the old format. The script counts it for numbering and for references, but does not check it or split it, and `check` reports each one. Offer the migration once, in the run where you first see one:

1. Run `migrate --dry-run` and summarise what it would do:
   - each file becomes `SDDnnn-<slug>/README.md`, split into section files where it is over the limit;
   - every markdown link to those files, anywhere in the repository, becomes the plain id;
   - every reference in a short or prose form becomes the full form: `SDD006§2.4.1/§12`, `SDD013§4.2 and §5.1`, `SDD007 §8`, `SDD001 (esp. §7)` and "§8.1.2 of SDD006" all come out as `SDDnnn§x.y`, a list joined by commas.
2. Suggest committing first, so the migration is one diff to review.
3. On yes, run `migrate`. It does only the mechanical part: the text is as the old rules left it. Repair the rest in this order.
   1. **References, across the repository**, before any SDD's text changes. Run `check` and repair each reference error. A label cited where a section number belongs, such as `SDD013§P6`, is reported with the headings that carry that label. Pick the section it means, or drop the reference when the sentence around it only tells history. Do this step first: the content step may take the labels out of the headings, and then nothing is left to resolve them by.
   2. **Structure.** A doc that `migrate` moved without splitting had a structural problem. Repair it, then run `fix` on it.
   3. **Links.** Each file moved one folder deeper, and `migrate` does not rewrite the relative links inside it. Run `lint` and repair each link it reports as pointing at nothing.
   4. **Content, one SDD at a time.** Run `lint SDDnnn` for the leads, then read the whole SDD and bring it to `Content`. Shorten a summary over the limit. Delete any note on how to cite or number the doc: the instructions block holds those rules now, and an old note may contradict them. The SDDs are independent of each other, so where you can hand work to subagents, give each SDD its own.
   5. **The agent instructions.** Replace the old SDD rules, as `The agent instructions` in [the configuration reference](references/config.md) describes. `check` may report example ids in the old rules, and replacing them clears those.

Design docs named another way, such as `SDD-001-mail.md` or a `design/` folder, are not SDDs to the script. If the repository has them, ask whether to bring them into the format. That work is manual: rename each file to `SDDnnn-<slug>.md` under `paths.sddRoot`, then migrate.

## Content

- **Check every statement against the live code** in this session, with a grep or a file read. Do not carry a claim over from the chat unchecked.
- **Cite code by path and symbol:** `OffersService.updateOffer` in `apps/api/src/offers/offers.service.ts`. Never cite a line number: lines move with every change, and an SDD is read long after it is written.
- **Cite the section in the code.** When a new section describes code that did not cite an SDD before, add one reference, `SDDnnn§x.y`, in a comment at that code's entry point. That reference is how the next change to that code finds the section. One per entry point is enough; do not cite on every function.
- **Current state only.** Never write "previously", "we changed", or "used to". Git holds the history. A section describes the system as it is now.
- **What an SDD holds:**
  - what the area is for and where its edges are;
  - its components and what each one owns;
  - its flows and state;
  - the rules and invariants other code has to follow;
  - the gotchas a newcomer would hit;
  - the reason behind a choice, or a link to the ADR that holds it.
- **What it does not hold:** what the code already says plainly. That means field lists, signatures, copied code and step-by-step walkthroughs of one function.
- **A rule another SDD holds is cited, not restated.** Say how this area applies it, and cite the section that holds it. See `A rule several areas follow`.
- **An outside constraint lives in the knowledge base.** When code is built around a rule from outside — a provider's API, a marketplace policy, a law — state how the code applies it and cite the knowledge-base section that holds the rule, `KBDOCnnn§x.y`. Do not restate the rule.
- **Link the ADR behind a design choice** when the repository has one. Put a relative path in the section that describes the choice. Leave the reasons to the ADR and do not restate them.
- **Write for an agent about to change this code.** Use short, dense sentences. Every sentence should be a fact that agent can act on.

## The script

It is `scripts/doc-check.js` in this skill's folder. Run it from the repository root. The Stop hook runs it too, where one is set up.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/doc-check.js" <command>
```

`${CLAUDE_SKILL_DIR}` is the folder this `SKILL.md` is in. If it reaches you unexpanded, write that folder's absolute path in its place.

| Command                        | Use it                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refs --changed`               | Step 4: the sections that changed code cites, and the knowledge-base sections that link changed files                                                                                                                                                                                                           |
| `refs --to SDDnnn§x.y`         | Step 5, and before moving a section to another SDD: everything that cites it, other SDDs included                                                                                                                                                                                                               |
| `next SDD`                     | Before creating an SDD: the id it takes                                                                                                                                                                                                                                                                         |
| `fix SDDnnn …`                 | After writing. It regenerates the index, breadcrumbs and pointers, sets heading levels, puts sections where they belong, merges back section files that fit, and moves the largest sections out of files over the limit. It rewrites, creates and deletes files, so read a file again before editing it further |
| `check SDDnnn …`               | After `fix`. It runs every rule, including references to those SDDs from anywhere in the repository                                                                                                                                                                                                             |
| `lint SDDnnn …`                | After `check`. Leads for the `Content` rules, all warnings: wording that tells history, fenced code, names in backticks that the code no longer has, and links that point at nothing                                                                                                                            |
| `migrate --dry-run`, `migrate` | Single-file SDDs into folders, and references into the full form. See `SDDs in the old format`                                                                                                                                                                                                                  |

### After fix and check

`fix` refuses to touch a doc with a structural problem: an anchor defined twice, a section whose parent does not exist, an unnumbered heading at section level, or text under a pointer. Repair those by hand first.

`check` then lists what fix cannot repair. The usual cases:

- **A summary over 500 characters.** Shorten it.
- **A reference to a section that does not exist.** Correct the reference, or add the missing heading. An anchor that exists only as a numbered list item, for example, needs a real heading.
- **A label where a section number belongs.** Cite the section it means, or drop the reference.
- **A line-number citation.** Cite the symbol instead.
- **A section over the limit with no subsections.** Divide it into nested sections, then run `fix` again.

`lint` is not a rule check. History wording is a phrase list, so it also catches some sentences about the present. Fenced code is often copied code, but not always. A name the code lacks may be stale, or may be a library's. Confirm each warning, and change only the text that is wrong.

### The Stop hook

The hook runs only where it is set up: the Claude Code plugin sets it up, and another agent needs it wired in by hand. Where it is set up, it runs the same rules at the end of every turn, on the docs changed since `HEAD`. When it sends the turn back, do what it says: run the `fix` command it prints, or repair the lines it lists.

Without the hook, nothing checks the SDDs after you. Step 8 is then the only check, so never skip it.

## Finish

Report to the user:

- **each SDD touched**, as a clickable link to its `README.md`, with what changed: the sections added, corrected or removed. Put a new SDD first, and mark it as new. Name a section moved to another SDD by both ids. Mark each correction found in passing, which no change caused and no one asked for, so it is easy to review;
- **what `fix` did**, if it moved sections between files;
- **anything `check` still reports**;
- **each rule the code breaks**, left as it is: the section and the code that breaks it, one line each, asking whether the code or the rule is wrong;
- **the knowledge-base sections that link changed code**, one line each, with a suggestion to run `to-kb` for any the change may have made wrong;
- **what fell below the bar**, one clause each, so a wrong call can be corrected in one line.

When nothing cleared the bar, say that no SDD needed changing, and give the reason in one clause.

Do not paste SDD text into chat. The user will open the file.
