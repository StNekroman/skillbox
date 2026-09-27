# Ticket template

The skeleton below is the shape. Copy it, fill what the research produced, and delete every other
section. Angle brackets mark a placeholder; no angle bracket survives into a written ticket.

Only four things are mandatory: the title, the field list, `## Risk if not implemented` and
`## Implementation risk`. Every other section appears when there is something real to put in it and
is deleted when there is not. Do not invent content to fill a heading.

Section order is fixed. Nothing is inserted between sections and nothing is reordered.

---

# Ticket Draft — <one line: the defect as a statement, or the change as an imperative>

- **Type:** `<Bug / Feature / Chore / Spike>`
- **Severity:** `<Critical / High / Medium / Low>`
- **Complexity:** `<Small / Medium / Large / X-Large>`
- **Repos:** `<repo>`, `<another repo, only when more than one must change>`

## Steps to reproduce

1. <the starting state: who is signed in, which space, what data exists>
2. <an exact action — a UI path, or a method plus endpoint plus body>
3. <as many steps as the reproduction needs; the last one exposes the defect>

## Actual result

<What is wrong, at the point where it becomes visible. One sentence when there is one observation.
A numbered list only when there are several, each naming the step it follows.>

## Expected result

<What should happen instead, answering the same observations in the same order.>

## Why this exists

<The mechanism, in prose. What the code does today, cited as `path/to/file.ts:123`, and why that
produces the actual result. A developer who has never opened this area should be able to find the
fault from this section alone.>

```ts
// path/to/file.ts:123
<the few lines that carry the fault>
```

## Scope

- <what changes, named by repository, then by file or entity>
- <the route or handler that has to exist, or the query that has to change>

## Non-goals

- <something a reader would reasonably assume is included, and is not, with one clause on why>

## Desired state

<How it behaves once this ships. Schema additions, new routes, new signals. Omit this section when
`Expected result` already describes the end state.>

## Migration plan

<Only when existing rows or a deployed contract have to change. Phases, in order, each one safe to
stop after.>

## Acceptance criteria

- [ ] <a condition that is verifiably true when the ticket is done>
- [ ] <another>

## Test matrix

| Case | Expected |
|---|---|
| <the main path> | <outcome> |
| <the boundary the mechanism turns on> | <outcome> |
| <nothing to act on — no rows, no matches> | <no error, no request, or a no-op> |
| <the operation runs twice> | <same state as running it once> |
| <cross-tenant: another tenant owns the neighbouring row> | <never read, never written> |

## Risk if not implemented

<What breaks, or keeps breaking, while this is deferred. Who notices it, and how bad it is for them.
This has to agree with the Severity field.>

## Implementation risk

<What a wrong implementation breaks. Name the specific paths that share the code being changed, and
what a plausible mistake would do to them.>

## Blast radius

### [BR-1] <the reach, as a statement — what it touches, not what might break>

<What this entry touches, the path by which the change gets there, and what bounds it. Cite files
and lines.>

### [BR-2] <the next one; number upward and never renumber an existing id>

<...>

## Open questions

### Q1 — <the question, as a question>

<What is unclear, what each answer would mean for the work, and who decides.>

## Related tickets

- [<KEY> — <issue summary>](<jira.site>/browse/<KEY>) — <parent of / child of / related; use this form whenever the ticket has a Jira id>
- [<ticket title>](<relative-path>.md) — <parent of / child of / related; use this form only for a draft with no id yet>

## References

- [<document title>](<relative path to a spec, ADR or tech doc>) — <what it decides>
- <an external document, named, with whoever owns the current revision>

## Blocked by

- [<KEY> — <issue summary>](<jira.site>/browse/<KEY>) — <what it has to provide before this one can start>
- [<ticket title>](<relative-path>.md) — <same, for a draft that has no id yet>
- <an off-repo blocker: another team's work, an infra change, an unmade decision — named, with its owner, no link>

## Blocks

- [<ticket title>](<relative-path>.md) — <what it cannot do until this one lands; a Jira id takes the browse-URL form instead>
