---
name: to-adr
description: Record the architecture decisions settled in the current conversation as ADR markdown files under the repository’s ADR directory — the decision, the alternatives weighed, why each lost, and the consequences. Writes nothing when the conversation settled nothing architecturally significant. Use when a design discussion has reached a decision worth keeping; do not use for tickets, specs, meeting notes, or minor choices.
metadata:
  prompt-version: "2026-10-01.1"
---

# Record an Architecture Decision

Turn a decision this conversation settled into an Architecture Decision Record: a short file that tells an engineer, a year from now, what was decided, what else was on the table, and why it lost.

The output is a markdown file in the repository's ADR directory. Most conversations produce none. An ADR directory is useful only while every file in it matters — one record about a button colour teaches its readers to skim the rest. So this skill's first job is deciding whether to write at all, and its default answer is no.

## Order of work

1. Find the candidate decisions in the conversation and hold each against `The bar`.
2. If none clears it, stop and report. The repository is not touched and nothing is asked.
3. Read the configuration, running its init if needed.
4. Read the ADR directory: what is already recorded, how records are named, what shape they take. Drop any candidate that is already recorded; if that leaves none, stop and report.
5. Write one record per decision, then report.

The bar comes before the configuration on purpose. When nothing qualifies, the user must not be asked where to store a file that will never be written.

## The bar

A candidate is a decision the conversation **settled**: one option was chosen, by the user or proposed and agreed. A question still open when the conversation ended is not a candidate. A record of it would claim a decision nobody made.

A settled decision is architecturally significant when at least one of these holds:

| Test | It holds when |
|---|---|
| Costly to reverse | Undoing it means migrating data at rest, changing a contract other services, clients or tenants depend on, or rewriting more than one component. A single-PR revert is not costly. |
| Reaches past one component | Other services, teams or future features have to conform to it. It is a rule, not an implementation detail. |
| Sets a precedent | The next feature of the same kind will copy it — where files go, how services talk, which store holds what. |
| Fixes a quality attribute | It decides tenant isolation, security, data retention, consistency, availability, or cost at scale. |

Every record must also pass one more check: a future engineer would plausibly ask *"why didn't they just …?"*, and the answer lives only in this conversation. A decision nobody would question needs no record.

These fall below the bar, however long the discussion about them ran:

- visual and copy choices — colours, layout, wording;
- naming, formatting, lint and code style;
- a bug fix that restores intended behaviour;
- a refactor inside one module that changes no contract;
- a helper library used inside one module;
- a value that can change with a deploy — a timeout, a limit, a batch size;
- the test plan for one feature;
- a one-off operational action;
- applying a decision an existing ADR or convention already made. Following a rule is not making one.

A conversation that clears the bar usually yields one record, sometimes two. If you count more than three, the bar has slipped: most of them are design choices inside one decision, and belong in its record.

### One decision, one record

A decision often arrives with several design choices — what identifies a file, whether the code is a library or a service, what scope deduplication has. They belong in one record when none of them can be reversed without reopening the others. When one can be reversed on its own, it is a separate decision and gets its own record.

### When nothing clears the bar

Write nothing. Reply in a few lines: that no ADR was written, then the closest candidates, each with the test it failed in one clause. When the conversation settled no decision at all, say that in one sentence.

If the user reads that and still asks for a record, write it — it is their repository. The same holds for a decision the user names in the request: hold it to the bar, and when it falls below, say why and write it only once they confirm.

## Configuration

Read `.skillbox/tickets.json` under the repository root. It supplies `paths.adrRoot`, the optional `paths.adrTemplate`, and `jira.site` for citing issues.

If the file is missing, or it has no `paths.adrRoot`, run the init in [the configuration reference](references/config.md), then carry on with the request. If `paths.adrTemplate` is set but the file it names does not exist, stop and ask — never fall back to the built-in template in silence.

If a record cites a Jira key and the file has no `jira.site`, ask for the site and add it, as the same reference describes.

A directory the user names in the request wins for this run. When the init is running anyway, that directory is also the answer to its question.

## Read the ADR directory

List `paths.adrRoot` before writing, and read:

- **Every record's title.** If a candidate is already recorded, do not record it again; name the record that holds it in the report. If a candidate reverses or replaces an earlier decision, its record supersedes that one — see `Superseding`.
- **The most recent record in full**, to match its tone, depth and header format.
- **Any record the new one builds on**, in full, so the two do not contradict each other.

A template file or an index in the directory is not a record.

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

The reasons are the conversation's reasons. Record what actually decided the question, not a better argument you can build afterwards. If the conversation chose without saying why — or a summary kept the decision and lost the reason — ask before writing: one question, naming each decision whose reason is missing. A record with an invented reason is worse than no record, because it will be trusted.

### Alternatives

Record only what was actually weighed. Never add an option nobody raised to make the decision look deliberated — a fabricated rejected option is a record of reasoning that never happened. An alternative that was named but never given a reason for losing stays out of the file; list it in the report so the user can supply one.

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
2. **The directory already names its records by one pattern** — `0007-use-cas.md`, `adr-007-use-cas.md`. Follow it, number format included.
3. **Otherwise** `ADR-<n>-<slug>.md`.

`<n>` is one more than the highest number any record in the directory has ever had. Count deleted records too — `git log --format= --name-only --diff-filter=D -- <adrRoot>` lists them. A number is never reused, because another document may cite it.

The title names the chosen approach and what it is for: "Content-addressable storage for file management", not "File storage". A title that names only the topic makes the reader open the file to learn the decision. The slug is the title in kebab-case: `content-addressable-storage-for-file-management`.

If the directory keeps an index — a `README.md` or `index.md` listing its records — add a line for the new record in the index's own format.

## Superseding

An accepted record is never edited. A decision that reverses or replaces an earlier one is a new record, and the old record changes in exactly one place.

- **The new record** links the old one under `Supersedes`, or wherever the template records it, and its context says what changed since the old decision was made.
- **The old record** gets the status `` `Superseded` by [ADR-<n>: <title>](<file>) ``. Nothing else in it changes.

A decision that only builds on an earlier one supersedes nothing. Cite the earlier record under `Relates to`.

A record this conversation wrote may still be revised in place when the conversation corrects it. Never create a `-v2` file.

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
- alternatives left out for lack of a reason, as a short list they can answer in chat;
- the candidates held below the bar, one clause each, so a wrong call can be corrected in one line.

Do not paste the record into chat. The user will open the file.
