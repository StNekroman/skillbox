---
name: jira-push-ticket
description: Create a Jira issue from a ticket draft file using the official Atlassian MCP server, optionally under a parent epic, then rewrite inbound references across the repository and rename the draft to its issue key. Use when a settled draft in the repository’s ticket-draft directory should become a real Jira issue; do not use to write the draft in the first place, and do not use to review or transition existing issues.
metadata:
  prompt-version: "2026-09-21.3"
---

# Push a Ticket Draft to Jira

Turn a markdown ticket draft into a Jira issue, then leave the repository consistent with the move.

Five things happen, in this order, for each draft:

1. the issue is created, with a description that reads as well in Jira as the file does in an editor;
2. its relationships to sibling issues become real Jira links, not prose;
3. every file that references the draft is rewritten to point at the issue;
4. the draft is renamed to its issue key;
5. the result is verified.

Steps 3 and 4 are not optional extras. A draft that moves without them leaves dead links behind, in
every ADR, spec and sibling draft that named it. They fail silently: the link still renders, and a
reader only finds it is dead by following it. A repository that has pushed drafts before is likely
to hold some already — grep for one if you want to see what this step prevents.

## Accepted input

- **The draft** — a path under `paths.draftRoot`, an area plus a title, or the file already under
  discussion. Required.
- **A parent epic** — an issue key such as `PROJ-455`, or a browse URL. Optional.
- **A project key** — one of `jira.projects`. Optional; see `Choosing the project`.

One draft file becomes one issue. Never merge two drafts into one issue, and never split one draft
across two.

## Before the first call

Read `.skillbox/tickets.json` under the repository root. It supplies `jira.site`, `jira.projects`,
`jira.severityToPriority`, `paths.draftRoot` and `paths.docRoots`. If it is not there, run the init
in [the configuration reference](../../CONFIG.md) and then carry on — this skill cannot run without
it, and guessing a site is not a recovery.

Pass `jira.site` as `cloudId` on every Atlassian MCP call. The tools accept a site URL wherever they
accept a site UUID, so no lookup call is needed.

Read the whole draft file. A draft is prose written by a person; skimming the headings and guessing
the rest produces an issue that disagrees with the file it came from.

## Stop if the draft already has an id

Two signals say a draft has been pushed before:

- the file is already named `<KEY>.md`;
- the field list carries an `Issue` bullet, which is how older drafts recorded an id before that
  field was retired.

Either one means stop. Do not create a second issue. Read the existing one and ask whether to
update it, replace its description, or create a separate issue anyway. Pushing twice is the one
mistake in this workflow that cannot be undone quietly — a stray issue stays in the board's history
even after it is closed.

Nothing else is a signal. A key in the body is a citation of a sibling, not a name for this draft.
Phase 4 of an earlier push is what put it there, so after one draft in a folder is pushed, every
draft beside it holds keys that are not its own — usually in `Related tickets`, sometimes in prose.
Read the file name and the field list, and nothing else, before deciding a draft has been pushed.

---

# Phase 1 — Plan

Gather everything before writing anything. The plan is what the user approves, so it has to be
complete.

## Choosing the project

| Given | Project |
|---|---|
| The user named a project | Use it |
| A parent epic was given | The epic's project — read the epic and take its key |
| Neither | Ask. Do not guess |

When a parent epic and a project key are both given and they disagree, stop and ask. Jira accepts a
parent only inside the same project, so one of the two is wrong.

## Choosing the issue type

Each project allows its own set, and the set changes without warning. Call
`listJiraProjectIssueTypesMetadata` on the chosen project and map onto what it returns. Never assume
a project has a given type: a create naming an absent one fails with
`issuetype: Specify a valid issue type`.

Map the draft's `Type` by preference, taking the first the project actually offers:

| Draft `Type` | Preference order |
|---|---|
| `Bug` | `Bug`, then `Task` |
| `Feature` | `Story`, then `Task` |
| `Chore` | `Task` |
| `Spike` | `Spike`, then `Task` |

If a project offers none of a row, say so and ask rather than picking something unrelated.

`Epic` is never inferred. Use it only when the user asks for an epic in so many words.

The real `Type` stays in the description's field list even when Jira cannot carry it. A `Bug` pushed
to a project with no `Bug` type is a Jira `Task` whose body still says `Type: Bug`, and that is the
only place a reader can learn what it is.

## Mapping the fields

| Draft field | Where it goes |
|---|---|
| `Type` | Decides the Jira issue type, and stays in the body's field list |
| `Severity` | Becomes the Jira `priority`. Removed from the body |
| `Complexity` | Stays in the body's field list |
| `Repos` | Stays in the body's field list |
| `Issue` | Retired from the template. An older draft may still carry one; never send it. See `Stop if the draft already has an id` |

Severity maps to priority by `jira.severityToPriority` in the config, which names the site’s own
priorities. A site that renames them, or disables priority entirely, is handled there and not here.

Check the mapped name against the create metadata for the target project before sending it. If the
site does not define it, report the disagreement and ask — do not substitute the nearest name.

## Finding every inbound reference

Search the whole repository for the draft's file name, with and without the `.md` extension. The
name is distinctive enough that a basename search is both sufficient and cheap.

These locations hold references today and must all be covered:

| Location | What refers to a draft from there |
|---|---|
| `paths.draftRoot` | `Related tickets`, `Blocked by`, `Blocks`, and prose in sibling drafts |
| Each of `paths.docRoots` | An ADR, spec or tech doc naming the ticket that implements it |
| Anywhere else | README files, CI config, code comments |

The configured roots are where references cluster, not where they are allowed to be. The search is
the whole repository either way; the roots only say where to look first, and what to check twice
before declaring the search clean.

Record each hit as a file, a line and the link shape. A draft that other drafts depend on will have
several. If a search returns nothing, say so in the plan rather than assuming the search was wrong.

## Present the plan and wait

Before the first write, tell the user:

- the project, issue type, priority and parent the issue will get;
- every Jira link that will be created, as a link type and a direction;
- any section the links empty out of the body, named so its removal is not a surprise;
- every file that will be edited, with how many references in each;
- the rename, as `old-name.md` to `<KEY>.md`.

Then wait for approval. Nothing in phase 2 or later runs before it.

---

# Phase 2 — Create the issue

## Building the summary

The draft's title line reads `# Ticket Draft — <title>`. The summary is `<title>` alone. Strip the
`Ticket Draft — ` prefix, and never carry a file name, a path or a tool name into the summary.

## Building the description

Author the body as **HTML** and pass `contentFormat: "html"`. Markdown is not an option here: it
drops task lists, and it truncates bold that contains inline code. Both appear in almost every
draft.

[The HTML mapping reference](references/html-mapping.md) gives the shape for every construct a
draft uses, and the three that need care. Read it before writing the body.

The body opens with the field list as a real bullet list, one bullet per line:

```html
<ul>
  <li><strong>Type:</strong> <code>Bug</code></li>
  <li><strong>Complexity:</strong> <code>Small</code></li>
  <li><strong>Repos:</strong> <code>api</code></li>
</ul>
```

Never join these onto one line with separators. A row of bullets running horizontally is what this
skill exists to prevent.

Everything after the field list carries over in the draft's own order. Do not reorder sections, do
not drop a section because it is long, and do not add one.

`Related tickets`, `Blocks` and `Blocked by` are the exception, because Jira carries those itself.
Drop from the body every entry in them that names an issue, and drop the whole section when that
empties it. What survives is only the entries naming drafts with no key yet. Phase 3 turns the
dropped ones into links; work out there which entries those are before writing the body, so the two
halves agree.

A dropped entry usually carries a sentence of reasoning, and a Jira link carries none. Check whether
that reasoning already appears elsewhere in the draft — a dependency worth writing down is normally
explained in `Why this exists` or `Risk if not implemented` as well. When it appears nowhere else,
say so in the report rather than keeping the section to hold it.

A citation in ordinary prose is untouched by all of this. Only the three relationship sections
become links; a sibling named in the middle of a paragraph stays where it is.

**Add nothing that was not in the draft.** No provenance line, no source-file path, no note about
which tool created the issue, no timestamp. The issue is the ticket now; where it came from is
noise to everyone who reads it afterwards.

## Creating it

One call to `createJiraIssue` carries everything:

```text
createJiraIssue({
  cloudId: "<jira.site>",
  projectKey: "<one of jira.projects>",
  issueType: "Task",
  priority: "Medium",
  parent: "PROJ-455",         // omit when there is no epic
  summary: "<the title>",
  contentFormat: "html",
  description: "<the HTML body>"
})
```

`parent` works on create. There is no need to create first and link afterwards.

If the create is rejected, the response names the field and carries a repair hint. Fix that one
field and retry once. Do not fall back to markdown, and do not strip content to make a failing call
pass — a body that fails validation is a bug in the body, not a reason to publish less of it.

Record the returned key. Every phase after this one needs it, and none of them runs if the create
failed.

---

# Phase 3 — Link the issue to its siblings

The entries dropped from `Related tickets`, `Blocks` and `Blocked by` become Jira issue links. A
link shows on both issues, survives the description being rewritten, and drives the board's
dependency views — none of which a bullet in a description does.

Only entries naming an issue become links. An entry naming a draft with no key stayed in the body,
and stays there until that draft's own push comes back for it.

## The two link types

A ticket draft needs exactly two relations: one that blocks and one that merely relates. Most sites
call them `Blocks` and `Relates`, and those names are what the table below uses. Read the site’s
link-type catalogue once per push and use the names it returns; if neither pair is recognisable,
name what the site offers and ask rather than guessing from a partial match.

| Draft section | `linkType` | `inwardIssue` | `outwardIssue` |
|---|---|---|---|
| `Related tickets` | the relates type | the new issue | the sibling |
| `Blocks` | the blocks type | the new issue | the sibling |
| `Blocked by` | the blocks type | the sibling | the new issue |

The direction rule is one sentence: `inwardIssue` **blocks** `outwardIssue`. Get it backwards and
the board shows the dependency pointing the wrong way, which is worse than no link at all — a wrong
arrow is believed. A relates link reads the same both ways, so its direction cannot be wrong.

## Creating them

One call per link:

```text
createJiraIssueLink({
  cloudId: "<jira.site>",
  linkType: "Relates",
  inwardIssue: "PROJ-459",
  outwardIssue: "PROJ-458"
})
```

Run it through `executeWrite` — `createJiraIssueLink` is not a primary tool. Do not pass `comment`:
it posts the text as a comment on the other issue, which is not where a relationship belongs.

A link that fails leaves the issue already created, so report the failure and carry on to phase 4.
Do not delete the issue and start over.

---

# Phase 4 — Rewrite inbound references

Every reference found in phase 1 now points at a file that is about to be renamed. Rewrite each one
to the issue.

The target is always the browse URL:

```text
<jira.site>/browse/<KEY>
```

Point at Jira, not at the renamed file. A reader following the link wants the issue's status,
assignee and comments, none of which the file has. The renamed file sits beside the referring one
and is still the wrong target: it is a snapshot, and it moves again the next time somebody
reorganises the folder.

## The four link shapes

| Shape in the source | Becomes |
|---|---|
| `[some phrase](bug-foo.md)` | `[some phrase](<jira.site>/browse/PROJ-458)` |
| `[bug-foo.md](bug-foo.md)` | `[PROJ-458](<jira.site>/browse/PROJ-458)` |
| `[text](../auth/bug-foo.md)` | the same URL — the relative depth stops mattering |
| `[text](bug-foo.md#a-heading)` | the same URL, anchor dropped; name the section in the text |

The link text decides the first two rows. A descriptive phrase survives the move and should be kept
as it is. A bare file name does not read as a link to an issue, so it becomes the key. Both forms
are correct in their place; the text you found decides which one you write.

An anchor has no equivalent. Jira builds heading anchors differently and they are not stable across
edits, so drop the fragment and put the section name into the sentence: `see the migration plan in
[PROJ-458](…)`.

A bare file name mentioned in prose with no link at all becomes a link to the issue.

## What not to rewrite

- **Relative links to ADRs, specs and tech docs.** Those files are not moving. They stay relative,
  in the pushed issue's body and in every other file.
- **Links to drafts that have no issue yet.** They keep pointing at the file. A draft only becomes a
  URL when it has a key.
- **Anything inside a fenced code block.** A path shown as an example is not a reference.

## Editing

Read each file before editing it, and change only the reference. Leave the surrounding sentence
alone unless the link text itself had to change, in which case make the sentence read naturally
with its new subject.

Do not stage anything. The user reviews the working tree themselves.

---

# Phase 5 — Rename the draft

Move the file to its key, in the same directory:

```text
<draftRoot>/auth/bug-session-token-outlives-its-session.md
  →  <draftRoot>/auth/PROJ-458.md
```

Use `git mv` so the rename is recorded as a rename rather than a delete and an add.

The file keeps everything: its title, its field list, its body. Nothing is deleted and nothing is
rewritten. The name now carries the id, and the draft template has no `Issue` field, so there is
nothing to add to the body. If the draft is an older one carrying an `Issue` bullet, delete that
bullet in this phase — the file name has just taken over the job.

A converted draft is renamed and nothing more. It is not emptied, not reduced to a link, and not
deleted: it stays the readable copy of what was agreed, next to its siblings.

---

# Phase 6 — Verify

Check six things, and report any that fail rather than fixing them silently.

- **The issue body.** Read it back with `getJiraIssue` and `responseContentFormat: "html"`. The
  field list is a bullet list, not one line. `Acceptance criteria` is
  `<ul data-type="task-list">` with an `<input type="checkbox">` per item. Every `## ` heading in
  the draft has an `<h2>`. The parent is set, when one was asked for.
- **The links exist and point the right way.** The same read with `view: "evidence"` returns
  `fields.issuelinks`. Each one names the sibling expected, and a `Blocks` link reads in the
  direction the draft meant — check the wording Jira returns (`inwardIssue` / `outwardIssue`), not
  the order the call was written in. No `Related tickets`, `Blocks` or `Blocked by` heading is left
  in the body holding an entry that became a link.
- **The old name is gone.** Search the repository for the draft's former basename. Nothing should
  match.
- **The new file exists** at the expected path.
- **The rewritten links resolve.** Each new URL carries the key that was actually created.
- **Nothing else changed.** `git status` shows the rename, the reference edits, and nothing more.

The echoed markdown in a write response is a lossy rendering, not what was stored. It shows `- [ ]`
for a task list that saved correctly. Judge the body only from an HTML read.

---

# Several drafts at once

**Push them strictly one at a time.** Finish all six phases for one draft before starting the
next. Never run two pushes in parallel, and never batch phase 4 across drafts.

Two reasons, and the second is the one that bites:

- **Shared referrers.** Sibling drafts cite each other, so two drafts in the same folder usually
  share at least one referring file. Parallel edits to one file lose changes.
- **Citation order.** If draft A cites draft B, B must have its key before A's body is written,
  or A ships citing a file path that is about to disappear.

So order the queue by citation. Push the most-cited drafts first and the ones that cite others last.

When two drafts cite each other, no order satisfies both. Push them in either order, then go back
and fix the first one's body with `editJiraIssue`. Say in the report that you did, so the extra
edit is not a surprise in the issue history.

---

# Finish

Report, for each draft pushed:

- the issue key as a browse URL, and the new file path as a clickable relative link;
- the issue type and priority chosen, and the draft `Type` and `Severity` they came from, so a
  wrong call is one line to correct;
- the parent epic, when one was set;
- every file whose references were rewritten, and how many in each;
- anything that did not survive as it is — a construct the reference says Jira cannot carry, a
  dropped anchor, or a reference you chose not to rewrite and why.

Do not paste the body into chat. The user will open the issue.
