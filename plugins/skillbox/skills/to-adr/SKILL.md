---
name: to-adr
description: Record the architecture decisions settled in the current conversation as ADR markdown files under the repository’s ADR directory — the decision, the alternatives weighed, why each lost, and the consequences. Shows a few-line summary of each first and writes only on the user’s yes; shows nothing when the conversation settled nothing architecturally significant. Use when the conversation settled how the system is built — where data lives, how components talk, what may depend on what, a contract others rely on; do not use for visual, UI or copy choices, naming, tunable values, bug fixes, tickets, specs or meeting notes.
metadata:
  prompt-version: "2026-11-25.1"
---

# Record an Architecture Decision

Turn a decision this conversation settled into an Architecture Decision Record: a short file that tells an engineer, a year from now, what was decided, what else was on the table, and why it lost.

The output is a markdown file in the repository's ADR directory. Most conversations produce none. An ADR directory is useful only while every file in it matters — one record about a button colour teaches its readers to skim the rest. So this skill's first job is deciding whether to write at all, and its default answer is no. When the answer is yes, the user still decides: they see a summary of a few lines, and nothing is written until they accept it.

## Order of work

1. Find the candidate decisions in the conversation and hold each against `The bar`.
2. If none clears it, stop and report. The repository is not touched and nothing is asked.
3. If the configuration exists, read the title of every record in the ADR directory and drop any candidate already recorded. Do not run the init here. If that leaves none, stop and report.
4. Show each remaining candidate as a summary and ask, as `Ask first` describes. Then stop until the user answers.
5. For each candidate the user accepted: read the configuration, running its init if needed, and read the ADR directory — how records are named, what shape they take.
6. Write one record per accepted decision, rewrite the ADR index, then report.

The bar and the summary come before the init on purpose. The user must not be asked where to store a file that will never be written, or one they have not agreed to.

## The bar

A candidate is a decision the conversation **settled**: one option was chosen, by the user or proposed and agreed. A question still open when the conversation ended is not a candidate. A record of it would claim a decision nobody made.

A settled decision is architecturally significant when at least one of these holds:

| Test | It holds when |
|---|---|
| Costly to reverse | Undoing it means migrating data at rest, changing a contract other services, clients or tenants depend on, or rewriting more than one component. A single-PR revert is not costly, and neither is a contract whose every consumer lives in this repository and ships with it. |
| Reaches past one component | Other services, teams or future features have to conform to it. It is a rule about how the system is built, not an implementation detail, a product rule or a look. |
| Sets a structural precedent | The next feature of the same kind will copy its structure — where code or data goes, how services talk, which store holds what. A convention — a name, a style, a colour — is not structure, however many places will follow it. |
| Fixes a quality attribute | It decides tenant isolation, security, data retention, consistency, availability, or cost at scale. |

Every record must also pass one more check: a future engineer would plausibly ask *"why didn't they just …?"*, and the answer lives only in this conversation. A decision nobody would question needs no record.

When you are unsure whether a test holds, it does not. A missing record costs one question to a teammate; a trivial one costs every reader of the log their trust in the rest.

These fall below the bar, however long the discussion about them ran, and even when a test above seems to hold. Every button after this one will copy its colour, and the colour is still not architecture:

- visual and copy choices — colours, spacing, layout, icons, component styling, wording — even when the whole app will follow them. How theming is built can clear the bar; which values it holds does not;
- how one screen behaves — what a button does, where a dialog opens, which field is required;
- a UI component or library picked inside a frontend whose framework is already settled — which dialog, toast, combobox or icon set;
- a product rule — what a feature does, its defaults, which setting overrides which, who may do what — unless it fixes a quality attribute above. It is a requirement the code meets, not a choice of how to build it, and it belongs in the spec, the ticket or wherever the repository logs product decisions;
- naming, formatting, lint and code style;
- a bug fix that restores intended behaviour;
- a refactor inside one module that changes no contract;
- a helper library used inside one module;
- a value that can change with a deploy — a timeout, a limit, a batch size;
- the test plan for one feature;
- a one-off operational action;
- applying a decision an existing ADR or convention already made. Following a rule is not making one.

A change to a decision an existing record holds is held to the bar like any other. The older record does not lift it over: a record that should never have been written must not make its every later tweak a record too. When the change falls below, `Superseding` says what the older record gets instead.

A conversation that clears the bar usually yields one record, sometimes two. If you count more than two, the bar has slipped: most of them are design choices inside one decision, and belong in its record.

### One decision, one record

A decision often arrives with several design choices — what identifies a file, whether the code is a library or a service, what scope deduplication has. They belong in one record when none of them can be reversed without reopening the others. When one can be reversed on its own, it is a separate decision and gets its own record.

### When nothing clears the bar

Write nothing and show no summary. When the user asked for an ADR — typed `/to-adr`, or asked in words — reply in a few lines: that no ADR was written, then the closest candidates, each with the test it failed in one clause. When the conversation settled no decision at all, say that in one sentence. When you invoked this skill on your own, at the end of a task, say nothing about ADRs.

If the user reads that and still asks for a record, show its summary — it is their repository — with `Bar` saying which test it fails: `Below the bar: one PR reverts it`. Their yes writes it. A decision the user names in the request is held to the bar the same way, and shown the same way when it falls below.

## Ask first

No file in the ADR directory is created or changed until the user has seen its summary and said yes. This holds whoever started the skill: a `/to-adr` the user typed asks for the summary, not yet for the file.

For each candidate, write one fenced `text` block, then one line that asks:

```text
Content-addressable storage for file management
Decision  Identify each file by SHA-256 of its content; store it once
Why       Tenants upload the same files; retries must not duplicate
Rejected  Path-based keys: duplicates on re-upload
          Provider dedup: our provider doesn't offer it
Cost      Every read resolves hash → path through a lookup
Bar       Costly to reverse: data at rest
```

Write it? `yes` / `no` / or say what to change.

- **The lines, in this order.** The title, unlabelled; then `Decision`, `Why`, `Rejected`, `Cost`, `Bar`. Add `Supersedes ADR-<m>` above `Bar` when the decision replaces a record. Pad the labels to one width, as above.
- **Fragments, not sentences.** One line per field, under 80 characters; `Rejected` takes one line per alternative. Fewer words are better: the user is deciding whether to have the record, not reading it. A field that will not fit one line is carrying detail the record will hold.
- **The title** is the record's title, as `File location and name` describes, with no number: the number is fixed when the file is written.
- **`Why`** gives the conversation's reasons, as `Reasons` requires. When it gave none, ask on that line: `Why       ? — what decided it?`.
- **`Rejected`** holds only what `Alternatives` allows: `<alternative>: <why it lost>`. An alternative named without a reason reads `<alternative>: lost why?`. Leave the line out when nothing else was weighed.
- **`Cost`** is the main negative consequence. It may be derived, as `Consequences` says.
- **`Bar`** names the test from `The bar` the decision clears, and the fact that makes it hold, in a few words.
- **Several candidates** each get a block, numbered on the title line — `1. Content-addressable storage …` — and one question after the last: Which to write? e.g. `1 yes, 2 no`.
- **An older record whose status alone would change**, as `Superseding` describes for a change below the bar, gets a block of its own: its file name and title, then `Status    Accepted → Superseded by <what holds the change>` and a `Why` line.

Then stop: run no init and write no file in the turn that shows the summary.

### The answer

- **Yes** — write the record from the conversation and the summary as accepted. The record says more than the block — the context, each design choice, every consequence — and nothing the block contradicts.
- **A correction or a filled `?`** — it is part of the conversation from then on: a reason the user gives is a reason the record may state. Write the record with it, and show no second summary unless the correction changes the decision itself rather than a line about it.
- **No** — drop the candidate. A no holds for the rest of the conversation: do not show it again, reworded or merged into another, unless the user asks.
- **Anything else** — the user moves on, or answers only part — writes nothing for the candidates the answer did not accept.

## Configuration

Read `.skillbox/tickets.json` under the repository root. It supplies `paths.adrRoot`, the optional `paths.adrTemplate`, `adr.index` for the ADR index, and `jira.site` for citing issues. Before the summary, only read it, and only when it exists; everything below, the init included, waits for a yes.

If the file is missing, or it has no `paths.adrRoot` or no `adr.index`, run the init in [the configuration reference](references/config.md), then carry on with the request. If `paths.adrTemplate` is set but the file it names does not exist, stop and ask — never fall back to the built-in template in silence.

If a record cites a Jira key and the file has no `jira.site`, ask for the site and add it, as the same reference describes.

A directory the user names in the request wins for this run. When the init is running anyway, that directory is also the answer to its question.

## Read the ADR directory

List `paths.adrRoot` and read:

- **Every record's title**, before the summary when the configuration exists, after the yes when the init had to create it. If a candidate is already recorded, do not record it again; name the record that holds it in the report. If a candidate reverses or replaces an earlier decision, its record supersedes that one — see `Superseding`.
- **The most recent record in full**, after the yes, to match its tone, depth and header format.
- **Any record the new one builds on**, in full, so the two do not contradict each other. Read it before the summary when it exists, so the summary does not contradict it either.

A template file or an index in the directory is not a record, and neither is the ADR index, `adr.index.path`.

## Structure

Take the shape from the first of these that exists:

1. **`paths.adrTemplate`.** Its sections, their order and its header format win over everything below.
2. **The records already in the directory.** Follow the structure of the most recent one. A log whose records all read alike is worth more than a better template used once.
3. **The built-in [ADR template](references/adr-template.md).** A comment in each section says what the section holds and whether it is mandatory.

Whichever shape wins:

- Keep its sections in its order.
- Follow a template's guidance comments, then delete them. No guidance comment and no `<placeholder>` survives into the written record.
- Leave out an optional section the conversation produced nothing for. Never write a heading followed by `N/A`, `TBD`, `None` or a placeholder: an absent section says "nothing here", and a padded one says something false.
- The rules in `Content` apply whatever the shape. When a template or a house format has no home for something those rules require — the alternatives, a negative consequence — put it in the nearest section rather than adding a heading the other records lack, and say so in the report.

## Content

These rules hold in every section of every shape. Work from the conversation as it stands, including any summary of earlier turns.

### The system today

Check every statement about how the system works today against the live code in this session, with a grep or a file read, before writing it. Do not carry it over from the chat unchecked. Name the service, module or path it concerns, but not line numbers: an accepted record is never edited, and a line number goes stale in weeks.

### Reasons

The reasons are the conversation's reasons. Record what actually decided the question, not a better argument you can build afterwards. If the conversation chose without saying why — or a summary of earlier turns kept the decision and lost the reason — ask before writing, on the `Why` line of the decision's summary. A record with an invented reason is worse than no record, because it will be trusted.

### Alternatives

Record only what was actually weighed. Never add an option nobody raised to make the decision look deliberated — a fabricated rejected option is a record of reasoning that never happened. An alternative that was named but never given a reason for losing is asked about in the summary's `Rejected` line, and stays out of the file unless the answer supplies one.

### Consequences

Consequences may be derived: they follow from the decision, and the conversation need not have spelled each one out. Reasons and alternatives may not be derived — those come from the conversation or not at all.

Every record states at least one negative consequence. A real decision costs something — more work for each consumer, a cost paid twice, a capability given up. A record with no negative is either not a decision or not honest, so find the cost, or go back to `The bar`.

## Status

A new record gets one of two values:

| Value | When |
|---|---|
| `Accepted` | The conversation settled it, and the people in it own the call. |
| `Proposed` | The conversation settled on a recommendation that someone outside it still has to approve. Use it only when the user said so. |

`Superseded` is written only on an older record, by `Superseding`. When the template or the house format names its statuses differently, use its nearest equivalents.

The yes to a summary lets the record be written; it is not the outside approval `Proposed` waits for, and it does not choose the status.

## Citing other documents

Wherever a record cites another document — in a field or mid-sentence:

| The thing cited | How to write it |
|---|---|
| Has a Jira id | `[PROJ-319 — <summary>](<site>/browse/PROJ-319)`, with `<site>` from `jira.site` |
| A ticket draft with no id | a relative path to the draft |
| An ADR, a spec, a tech doc | a relative path |

Never invent an id or a URL. When the Atlassian MCP server is reachable — it arrives with the `skillbox-jira` plugin — read each cited key once with `getJiraIssue`, to confirm it resolves and take its real summary for the link text. If the server is unreachable, write the key you were given and say in the report that it is unverified.

## File location and name

Write to `<adrRoot>/<name>.md`, creating the directory if it does not exist. Pick the name by this precedence; the first match wins.

1. **The user gave a file name.** Use it exactly.
2. **The directory already names its records by one pattern** — `0007-use-cas.md`, `adr-007-use-cas.md`. Follow its prefix and number format. The slug still follows the rule below, even where older records have long ones.
3. **Otherwise** `ADR-<n>-<slug>.md`.

`<n>` is one more than the highest number any record in the directory has ever had. Count deleted records too — `git log --format= --name-only --diff-filter=D -- <adrRoot>` lists them. A number is never reused, because another document may cite it.

The title names the chosen approach and what it is for: "Content-addressable storage for file management", not "File storage". The ADR index lists each record by its title and status alone, and an agent about to make a design choice picks the records to open from it. A title that names only the topic makes it open the file to learn the decision, or skip a record it should have read.

The file name is not the title. Its slug names the chosen approach alone, in two to four words of kebab-case and at most 30 characters: `content-addressable-storage`, so the file is `ADR-7-content-addressable-storage.md`. Never `ADR-7-files-are-identified-by-the-sha-256-of-their-content-so-each-is-stored-once-not-by-path.md`. People find a record by scanning the directory listing, and a long name wraps, gets cut off in the file tree, and reads like a sentence. The title and the index carry the rest. So the slug leaves out what the approach is for, the design choices, the rejected alternatives, and the words that only join others: `for`, `of`, `the`, `with`, `use`, `using`, `not`. Count the slug's characters before writing the file, and shorten it when it is over 30.

If the directory keeps an index by hand — a `README.md` or `index.md` listing its records — add a line for the new record in the index's own format. Never edit the ADR index: see `The ADR index`.

## Superseding

An accepted record is never edited. A decision that reverses or replaces an earlier one, and clears the bar, is a new record, and the old record changes in exactly one place.

- **The new record** links the old one under `Supersedes`, or wherever the template records it, and its context says what changed since the old decision was made.
- **The old record** gets the status `` `Superseded` by [ADR-<n>: <title>](<file>) ``. Nothing else in it changes.

A decision that only builds on an earlier one supersedes nothing. Cite the earlier record under `Relates to`.

When the change to an earlier record's decision falls below the bar, write no new record. The older record must still not read as current, since agents follow accepted records. So, once the user says yes to its summary, change its status, and nothing else, to `` `Superseded` by <link> ``, or to `` `Accepted`, partly superseded by <link> `` when the rest of it still stands. The link goes to whatever holds the change: the SDD section, the spec, the ticket or the design-log entry. Name the record in the report.

A record this conversation wrote may still be revised in place when the conversation corrects it. Never create a `-v2` file.

## The ADR index

`adr.index.path` is a generated file listing every record, its title linking the file, then its status. It is git-ignored, and the repository's agent instructions send an agent to it before a design choice, so a record it lacks goes unread. Rewrite it after writing a record, and after giving an older one the status `Superseded`:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/doc-check.js" index
```

Run it from the repository root. `${CLAUDE_SKILL_DIR}` is the folder this `SKILL.md` is in. If it reaches you unexpanded, write that folder's absolute path in its place. Where the start-of-turn hook is set up, it rewrites the index before every prompt as well.

The index reads the status from a `Status:` field above the first section, from a section titled `Status`, or from `status:` in front matter. Keep it in one of those, as the built-in template does.

## Linking from ticket drafts

When a ticket draft written in this conversation implements the decision, add the record to that draft's `## References`: one line, with the link and what the record decides. Create the section where the ticket template places it if the draft has none, and change nothing else in the draft.

Skip a draft named `<KEY>.md`. It is a snapshot of an issue already in Jira, and editing it changes nothing anyone reads.

## Writing style

- Short sentences. Plain words. Keep the technical terms.
- Write as of the decision date. Nobody updates a record when the code moves on, so leave out whatever is true only this week.
- Prose for context and reasons; bullets for design choices and consequences.
- No hedging and no filler. Drop "simply", "just", "obviously", "it should be noted".
- A record reads in five minutes. If it runs longer, it is carrying a spec or a design doc — link that under `Relates to` instead of copying it in.

## Finish

Report to the user:

- each path written, as a clickable relative link — including an older record whose status changed, an index that gained a line, and a draft that gained a reference;
- the status given to each new record;
- alternatives still left out for lack of a reason, as a short list they can answer in chat;
- the candidates held below the bar, one clause each, so a wrong call can be corrected in one line.

Leave out the candidates the user declined.

Do not paste the record into chat. The user will open the file.
