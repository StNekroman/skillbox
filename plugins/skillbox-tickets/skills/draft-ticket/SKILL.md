---
name: draft-ticket
description: Write or update a ticket draft as a markdown file under the repository’s ticket-draft directory, using a fixed ticket structure. Use when chat research has settled enough to be flushed into one or more ticket files; do not use to create, edit, transition, or comment on items in an issue tracker.
metadata:
  prompt-version: "2026-09-21.1"
---

# Draft a Ticket

Turn settled research into ticket files a developer can implement without reading the chat that produced them.

The output is a markdown file in this repository. It may later be copied into an issue tracker, or it may stay here and be read as it is. This skill writes the file and nothing else — it never creates or changes anything in a tracker.

## Configuration

Read `.skillbox/tickets.json` under the repository root before writing anything. It supplies
`paths.draftRoot`, `paths.docRoots`, `domainNotes`, and `jira.site` for citing issues.

If it is not there, run the init described in [the configuration reference](../../CONFIG.md),
then carry on with the request. Skip the Jira half of that init unless a ticket in this
conversation carries a Jira key — writing a draft does not need a tracker.

## Accepted input

Accept a target directory or area, a working title, an explicit file name or naming pattern, and whatever the conversation has settled. Any of these may be missing; infer the area from the code under discussion and ask only if the destination is still ambiguous.

## One deliverable, one file

Write one file per deliverable. Never merge two deliverables into one ticket to save a file, and never split one deliverable across two files. If the research settled four separate defects, write four files.

A deliverable is one thing a developer can finish, test and merge on its own. If two parts must ship together to be correct, they are one ticket.

## Verify before writing

Every statement about how the code behaves today must be checked against the live code in this session, with a grep or a file read, and cited as `path/to/file.ts:123` relative to the repository root.

- Do not cite from memory, from a nightly index, or from an earlier conversation.
- Do not carry a claim from the chat into the file without checking it. Research notes drift; the file is what a developer will trust.
- Confirm that every repository named in the `Repos` field actually has to change. Drop the ones that do not.
- When `domainNotes` is set, read it before writing about anything it covers. It records the traps a newcomer to this codebase falls into — two columns that are two names for the same thing, a field that means something other than its name. A ticket that gets one wrong sends the developer down the wrong path.

Read one existing ticket in the target folder before writing, to match its tone and depth.

Do not run builds, tests, migrations or lint to write a ticket. Reading and grep are the right tools here.

## File location and name

Drafts live in `paths.draftRoot`. Write to `<draftRoot>/<area>/<name>.md` unless the user names a different directory — theirs wins, including one they named earlier in the same conversation.

Pick the name by this precedence. First match wins.

1. **The user gave a file name, or a naming pattern.** Use it exactly. Do not add a prefix to a name they chose.
2. **The ticket has an id in a tracker.** Name the file `<ID>.md`. This holds whether the id existed before the draft was written or arrived afterwards.
3. **Otherwise** `<prefix><slug>.md`, where the prefix is the `Type` field lowercased and the slug is kebab-case.

| Type | File name |
|---|---|
| `Bug` | `bug-notifications-survive-archive.md` |
| `Feature` | `feature-notification-read-state.md` |
| `Chore` | `chore-split-limitador-dev-and-prod-config.md` |
| `Spike` | `spike-measure-run-row-growth.md` |

The slug names the problem, not the fix — `bug-notifications-survive-archive`, not `bug-add-clear-on-archive`. A fix changes during implementation; the problem does not.

- When an id arrives later, rename the file to `<ID>.md` and rewrite every reference to it as a browse URL. The two happen together, never separately: a rename on its own breaks every inbound link. The `jira-push-ticket` skill does both as one step.
- Update an existing draft in place. Never create a `-v2` file. Ask before overwriting a file you have not read in this session.

## Citing a ticket that is already in Jira

Some of what a draft references is a real Jira issue rather than another draft. Cite those as Jira, never as a file path.

A reference has an id when either is true:

- the file it points at is named `<KEY>.md`;
- the user or the conversation gave you its key.

| The thing being cited | How to write it |
|---|---|
| Has a Jira id | `[PROJ-319 — Concurrent edits overwrite each other silently](<site>/browse/PROJ-319)`, with `<site>` from config |
| Is a draft with no id | `[Give a notification a read state](B2-notification-read-state.md)` |
| Is an ADR, spec or tech doc | a relative path, always — those are documents, not tickets |

This applies everywhere in the file, not only in `Related tickets`, `Blocked by` and `Blocks`. A key named mid-sentence is a citation too and takes the same link.

A relative path to a `<KEY>.md` file is the mistake this rule exists to prevent. That file is a local copy of something that lives in Jira, so a path sends the reader to a snapshot instead of to the issue's real status, assignee and comments — and it breaks silently the moment the file is renamed or deleted.

Never invent an id or a URL. A draft with no id gets a relative path and nothing else; a made-up key is worse than no link.

When the Atlassian MCP server is reachable, read each cited key once with `getJiraIssue` before writing it. That confirms the key resolves and gives you the issue's real summary for the link text. If the server is unreachable, write the key you were given and say in the report that it is unverified.

## Structure

Copy the skeleton in [the ticket template](references/ticket-template.md) and fill it. Keep the section order exactly as the template has it.

**Four things are mandatory: the title, the field list, and the two risk sections at the bottom. Every other section is optional.**

A section exists to carry something the research actually produced. When the research produced nothing for it, leave the section out. An absent section reads as "nothing to say here", which is useful information. An invented section is a false claim a developer will act on, and it costs them more than the gap would have.

So: never write a heading followed by `N/A`, `TBD`, `None`, or a placeholder, and never pad a section to make the file look complete.

The reverse mistake matters too. Omit a section because the ticket has nothing for it, never because filling it would take work.

| Section | Include it when |
|---|---|
| `# Ticket Draft — <title>` | always |
| field list | always |
| `## Steps to reproduce` | reproduction is known — this block is all three sections, or none |
| `## Actual result` | as above |
| `## Expected result` | as above |
| `## Why this exists` | there is a mechanism to explain |
| `## Scope` | the change touches files or entities you can name |
| `## Non-goals` | a reader would otherwise assume something is included |
| `## Desired state` | the end state is not already clear from `Expected result` |
| `## Migration plan` | existing rows or a deployed contract have to change |
| `## Acceptance criteria` | the bar is not already stated by `Expected result` |
| `## Test matrix` | anything about the change is testable |
| `## Risk if not implemented` | always |
| `## Implementation risk` | always |
| `## Blast radius` | the change reaches beyond the files it edits |
| `## Open questions` | something is genuinely unresolved |
| `## Related tickets` | a sibling, parent or child draft exists |
| `## References` | a spec, an ADR or an external document decides part of this |
| `## Blocked by` | another ticket or decision has to land first |
| `## Blocks` | another ticket waits on this one |

### The reproduction block

`Steps to reproduce`, `Actual result` and `Expected result` come first, directly under the field list, because they are what a developer reads to confirm they are looking at the right problem.

The three are one block. Write all three or none.

- Steps start from a clean state. Name who is signed in, which space, and what data exists before step 1.
- Steps are concrete. A UI path, or a method plus endpoint plus body. Not "create some events".
- Use as many steps as the reproduction needs. Two is fine; so is nine. Never pad to reach a number, and never merge two actions into one step to look short.
- Record an observation only where something meaningful happens — usually one, at the last step. Do not write a line per step. When an observation follows an earlier step, name it: "After step 3, the badge still reads 5".
- `Actual result` and `Expected result` answer the same observations in the same order. A single observation is a sentence, not a one-item list.
- `Expected result` states behaviour, not an implementation. "The badge drops to 2", not "the handler should clear by subject".

If the ticket is a defect that nobody has reproduced yet, leave the block out and say so in `Why this exists`, naming what would be needed to reproduce it.

### Why this exists

The mechanism, in prose. What the code does today, cited by file and line, and why that produces the actual result.

A developer who has never opened this area should be able to find the fault from this section alone. When a ticket has a mechanism, this is the section worth spending effort on; it is also the one that goes stale fastest, so cite lines rather than paraphrasing logic.

A change with no mechanism to explain — a config value, a dependency bump — does not need this section.

### Test matrix

A table of case to expected outcome.

Write it whenever anything about the change is testable. A ticket that could carry a test matrix and does not is unfinished, so omit it only when there is genuinely nothing to assert: a config-only or docs-only change.

Include, when the ticket touches the matching concern:

- a cross-tenant case: the operation never reads or writes another tenant's rows;
- a repeat case: running the operation twice leaves the same state as running it once;
- the empty case: no rows, no notifications, nothing to do — no error;
- the boundary that the mechanism actually turns on, named concretely.

### Risk if not implemented, and Implementation risk

Both are mandatory. They are the two sections that survive when everything else about a ticket is still vague, because they are what a reader weighs when deciding whether to schedule it.

They answer different questions and must not repeat each other.

- `Risk if not implemented` — what breaks, or keeps breaking, while this is deferred. Who notices, and how bad it is for them. This has to agree with the `Severity` field.
- `Implementation risk` — what a wrong implementation breaks. Name the specific paths that share the code being changed, and what a plausible mistake would do to them.

If a risk is genuinely unknown, say what is unknown and what would settle it. That is a real answer. Leaving the section out, or writing "low risk" with nothing behind it, is not.

### Blast radius

How far the change reaches, as opposed to how it can go wrong. `Implementation risk` names the mistakes; this section names the surface.

Write it when the change reaches past the files it edits.

Each entry is one thing about the reach. Give it an id and its own block:

```markdown
### [BR-1] Two producers emit the count, not one

`notifications.controller.ts:147` counts after a write; `create-notification.job-consumer.ts:61`
counts on every notification created. Both carry `count` on the same signal, so both have to change
together or the badge alternates between two meanings.
```

- Number them in the order written, from `BR-1` upward.
- **Ids are permanent.** Append a new entry at the end. Never renumber, and never reuse the id of one you removed — a review report, a PR comment or a verification record may already cite it. `review-with-blast` preserves these ids rather than reassigning them.
- The title states the reach, not the risk: "The signal crosses api-gateway, which re-declares the payload shape", not "api-gateway might break".
- The block under it says what the entry touches, the path by which the change gets there, and what bounds it. Cite files and lines.
- Other sections may cite an id. A test matrix row reading `covers BR-2` is worth more than writing the same case twice.

Look for an entry in each of these, and write one wherever there is something real:

- a service, table, queue, job, index, cache, search index or client the change touches;
- something that reads a contract being changed and sits outside `Scope` — a shared DTO's other consumers, a gateway that re-declares a payload shape, a second producer of the same event;
- the most users, tenants or rows one mistake could reach, and what bounds it;
- a window where old and new versions run at the same time, and the deploy order that follows;
- a step that cannot be reversed.

A small diff does not mean a small blast radius. Grep for the contract being changed rather than reasoning about who probably consumes it.

### Open questions

Only genuinely unresolved questions belong here. A question the conversation answered is a statement in the body, not a question in this section — the whole point of flushing research to a file is that the answers stop being open.

For each one, write what is unclear, what each answer would mean for the work, and who decides.

### Related tickets

Reference a sibling, parent or child ticket by its title, and name the relation: parent of, child of, or related. Link it by the rule in `Citing a ticket that is already in Jira`. Blocking relations do not go here; they have their own two sections.

### Blocked by, and Blocks

Two directions of one relation, each in its own section, each present only when it has an entry.

- `Blocked by` — what has to land before this ticket can start, or before it can be correct.
- `Blocks` — what cannot proceed until this one lands.

One line per entry: the link, the title, and why it blocks. A bare link does not tell a planner whether the dependency is hard or merely convenient.

```markdown
## Blocked by

- [PROJ-319 — Concurrent edits overwrite each other silently](https://example.atlassian.net/browse/PROJ-319) — supplies the version column the retry check reads.
- [Give a notification a read state](B2-notification-read-state.md) — needs the mark-read operation and the by-subject route.

## Blocks

- [Clear notifications on task completion](bug-B2-clear-notifications-on-task-completion.md) — has nothing to mark read until this lands.
```

The first entry has a Jira id, the others do not. That is the only thing deciding which form each link takes.

- Link an entry by the rule in `Citing a ticket that is already in Jira`, as in `Related tickets`.
- A blocker outside this repository — another team's work, an infrastructure change, a decision nobody has made — is still an entry. Name it and name who owns it, with no link.
- The two directions have to agree across files. When you write both tickets in the same pass, state the relation in both. When the other file already exists and you are not writing it, say so in the report at the end and let the user decide whether to update it.
- `Blocked by` is not `related`. If this ticket can ship first and still be correct, the other ticket belongs in `Related tickets`.

## Fields

The fields sit directly under the title, as a bullet list with each value in code style:

- **Type:** `Feature`
- **Severity:** `High`
- **Complexity:** `Large`
- **Repos:** `api`, `infra`

There is no `Issue` field. A draft that has a tracker id is named for it, so the file name is the only place the id lives and the two can never disagree. There is no status field either: a draft's state lives in its folder and in `Open questions`.

Use these values and no others. A free-form severity drifts within a week.

**Type** — `Bug`, `Feature`, `Chore`, `Spike`.

**Severity** — the consequence of leaving it alone, never the effort to fix it.

| Value | Meaning |
|---|---|
| `Critical` | Data loss, a cross-tenant leak, or the product is unusable for an affected user. No workaround. |
| `High` | A core workflow gives a wrong result or is blocked. A workaround exists but a user would not find it. |
| `Medium` | A workflow is degraded, or wrong in a narrow case. The workaround is obvious. |
| `Low` | Cosmetic, or it affects only internal operation. |

**Complexity** — the shape of the change, not the calendar.

| Value | Meaning |
|---|---|
| `Small` | One service. No schema or contract change. |
| `Medium` | One service, or a contract only its own callers see. May add a column or an index. |
| `Large` | Several services, a migration over existing rows, or two repositories that must deploy in order. |
| `X-Large` | A migration that cannot be rolled back, or a change needing a phased rollout. |


**Repos** — the repositories that must change, comma separated. Unlike the three fields above,
this one has no fixed value set: name the repositories as your organization names them, and name
only what changes.

The field list is mandatory, so every bullet in it needs a real value. If you cannot pick one, say so in the report at the end and let the user decide — do not guess a severity to fill a bullet.

Keep the fields consistent with the body. `Severity` must match `Risk if not implemented`. `Complexity` must match `Repos` and any migration named in `Scope`. If they disagree, one of them is wrong; fix it before writing the file.

## Writing style

- Short sentences. Plain words. Keep the technical terms.
- Current state only. No "previously", "this used to", "we changed this". Git holds the history.
- Tables for matrices, prose for mechanism. A mechanism broken into bullets loses the causal chain.
- State a fact once, in the section that owns it. Repetition across sections is how a ticket becomes unreadable.
- No hedging and no filler. Drop "simply", "just", "obviously", "it should be noted".

## Finish

Report to the user:

- each path written, as a clickable relative link;
- the `Type`, `Severity` and `Complexity` assigned to each, so a wrong call can be corrected in one line;
- the sections you left out where a reader might expect one, in a few words each, so the user can fill a real gap;
- the open questions that remain, as a short list they can answer in chat.

Do not paste the file body into chat. The user will open the file.
