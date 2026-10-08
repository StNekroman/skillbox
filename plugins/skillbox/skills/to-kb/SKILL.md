---
name: to-kb
description: Add research results and facts about the world outside the code — services the product integrates and their rules, laws and policies it must follow, its market and users, know-how the team wants to keep — to the repository’s knowledge base, as KBDOC pages that carry their sources. Use after a task turned up findings the user agreed to keep, or when the user asks to add something to the knowledge base; do not use for how the repository’s code works (to-sdd), for decisions (to-adr), tickets or code comments.
metadata:
  prompt-version: "2026-10-07.1"
---

# Add to the knowledge base

The knowledge base is the repository's memory of the world the product lives in: the services it integrates and how they behave, the rules outside parties enforce, the laws and policies it must follow, what research found about its market and users, and know-how the team wants to keep. Each page covers one topic, `KBDOCnnn-<slug>/`. Agents write the pages for agents, and they are committed with the code, so the team shares them.

The knowledge base sits beside the SDDs, which hold how the repository's own code works and which the `to-sdd` skill keeps. An SDD statement is checked against the code. A knowledge-base fact cannot be: it comes from outside. So every fact an agent adds here carries its source, and nothing is written without the user's yes.

## Order of work

1. **Gather what to add.** Take it from the user's request, or from what this conversation found: research results, a service's documented behaviour, a rule an outside party enforces, something the user stated. Hold each fact against `What belongs`.
2. **Ask the user**, unless they asked for this. List each fact in one line, with its source and the page it would go to: an existing page by its id, or a new one. Write only what they confirm. When nothing qualifies, say so in one line and stop. Do not read the config and do not ask anything else.
3. **Read the configuration**, running its init if needed. See `Configuration`.
4. **Find the pages.** Read the knowledge-base index, `kb.index.path`: every page with its summary. Without one, list the folders in `paths.kbRoot` and read the first paragraph of each `README.md`. For each page you will change, read its `README.md` first, the summary and then the index, then the sections you will touch.
5. **Decide where each fact goes:** a correction to a section, a new section in the page whose summary names the topic, or a new page for a topic no page covers. `next KBDOC` gives a new page its id. Keep one page per topic.
6. **Write it**, following [the format](references/format.md) and `Content`. Read the format before you write.
7. **Run `fix`, then `check`, then `lint`**, all scoped to the pages you wrote. Repair what `check` still reports. Each `lint` warning is a lead: confirm it, and correct the text where it is wrong.
8. **Report.** See `Finish`.

## What belongs

A fact belongs when all three hold:

- **It is about the world outside the code, or about where our product meets it:** what a service does, what a rule requires, what research found, how our feed falls short of a marketplace's rules. How our own code works belongs in an SDD. A decision the team made, with the options weighed, belongs in an ADR.
- **Someone will need it again, and it is not one search away.** A fact the next agent would otherwise rediscover, or get wrong, is worth a line. Trivia is not.
- **It has a source.** See `Sources`.

A page may mention our code and link to it. Write such a link as a relative markdown link, or as a path from the repository root in backticks: `to-sdd` reports every knowledge-base section that links a file when that file changes, so the page is looked at again when the code under it moves.

## Sources

- **A fact from your own research cites its source** in the section that states it: a URL with the date you read it, a file in `<kbRoot>/attachments/`, or a subsection of the page's `Evidence` section. Nothing from your own memory goes in without a source you checked in this session.
- **What the user tells you** is cited as theirs, with the date: `(user, 2026-10-04)`.
- **A fact that changes with time carries its date:** a fee, a limit, a policy, a price.

### The `Evidence` section

A page may keep its sources in a top-level section titled `Evidence`, one subsection per source, with the date in the subsection's title: `### §4.1 Suspension email, 2026-09-03`. The page's claims cite it as `§4.1`. A source is one of two kinds:

- **A record**: an email, a support reply, the notes of a call, a research session's findings. It happened once. Quote it as received, and never edit it while anything cites it. A newer event is a new subsection.
- **A copy of an outside document**: a policy page, an API reference. Its owner changes it. Keep only the part the page relies on, with its URL and the date read, and refresh it in place: git keeps the versions and shows what changed.

A binary — a PDF, a screenshot, a contract — goes in `<kbRoot>/attachments/`, linked from the section that relies on it.

## Configuration

Read `.skillbox/tickets.json` under the repository root. It supplies `paths.kbRoot`, `kb.maxLines` and `kb.index`, and `paths.sddRoot`, `sdd.maxLines` and `sdd.index` for the SDDs.

If the file is missing, or lacks any of those six keys, run the init in [the configuration reference](references/config.md), then carry on. The init writes the missing keys, and in the same run settles the repository's agent instructions, which name both stores. The script has no default limit, so the value in force is always the one in the file.

A directory the user names in the request wins for this run. When the init is running anyway, that directory is also the answer to its question.

## Content

- **Say what is true now, with dates.** A history that matters — a policy that changed, a timeline — is content: date it. Never leave a superseded statement beside its replacement: rewrite the section, and let the `Evidence` section keep the old record.
- **Write for an agent about to work with this service or topic.** Use short, dense sentences. Every sentence should be a fact that agent can act on.
- **Code samples and quoted text are fine** where the page is about them: a request an API accepts, a clause a policy states.
- **One fact in one place.** When a fact belongs to another page's topic, cite that page's section instead of repeating it. An SDD that applies a rule cites the page; the page need not describe the code that applies it.

## The script

It is `scripts/doc-check.js` in this skill's folder. Run it from the repository root. The Stop hook runs it too, where one is set up.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/doc-check.js" <command>
```

`${CLAUDE_SKILL_DIR}` is the folder this `SKILL.md` is in. If it reaches you unexpanded, write that folder's absolute path in its place.

| Command | Use it |
|---|---|
| `next KBDOC` | Before creating a page: the id it takes |
| `refs --to KBDOCnnn§x.y` | Before rewriting or removing a section: the SDDs and code that cite it, which may need the same correction |
| `fix KBDOCnnn …` | After writing. It regenerates the index, breadcrumbs and pointers, rewrites the store's index file, sets heading levels, puts sections where they belong, merges back section files that fit, and moves the largest sections out of files over the limit. It rewrites, creates and deletes files, so read a file again before editing it further |
| `check KBDOCnnn …` | After `fix`. It runs every rule, including references to those pages from anywhere in the repository |
| `index` | When the knowledge-base index is missing or behind the pages: rewrites it. `fix` and the start-of-turn hook keep it current, so this is seldom needed |
| `lint KBDOCnnn …` | After `check`. On a knowledge-base page it reports labels in titles, paths in backticks the repository does not have, and links that point at nothing. It does not flag history wording, code samples or outside names: on these pages those are content |

`fix` refuses to touch a page with a structural problem: an anchor defined twice, a section whose parent does not exist, an unnumbered heading at section level, or text under a pointer. Repair those by hand first, then run it again. `check` then lists what fix cannot repair: a summary over 500 characters, a reference to a section that does not exist, a label where a section number belongs, a section over the limit with no subsections to move out.

The Stop hook, where it is set up, runs the same rules at the end of every turn on the docs changed since `HEAD`. When it sends the turn back, do what it says. Without it, step 7 is the only check, so never skip it. The start-of-turn hook, where it is set up, rewrites the index files before every prompt and says nothing.

## Finish

Report to the user:

- **each page touched**, as a clickable link to its `README.md`, with the sections added, corrected or removed. Put a new page first, and mark it as new;
- **what `fix` did**, if it moved sections between files;
- **anything `check` still reports**;
- **what you proposed and the user declined**, one clause each.

Do not paste page text into chat. The user will open the file.
