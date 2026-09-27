# ADR-<n>: <the chosen approach and what it is for, in a few words>

<!-- Mandatory: Date — the day the record is written, as YYYY-MM-DD — and Status.
Optional: Relates to — the specs, tech docs, ticket drafts, issues and records that decide or
implement part of this one; Supersedes — only on a record that replaces an earlier one. Drop an
optional bullet that has nothing in it. -->

- **Date:** <YYYY-MM-DD>
- **Status:** `<Accepted / Proposed>`
- **Relates to:** [<doc title>](<relative path>), [<KEY> — <issue summary>](<jira.site>/browse/<KEY>)
- **Supersedes:** [ADR-<m>](<relative path>)

## Problem

<!-- Mandatory. The problem that forced a decision, and the forces acting on it: constraints,
scale, cost, what the system does today. Someone who was not in the conversation should see from
it why doing nothing was not an option. -->

## Decision

<!-- Mandatory. Open with one sentence that states the decision as a rule: "Use
content-addressable storage: identify every file by the SHA-256 of its content."
When the decision comes with design choices, give each its own bullet, shaped as below: the choice
in bold, then what it means in practice and why, in the same bullet. A choice without its reason
is half a record. -->

- **<design choice>** — <what it means in practice, and why it was chosen>.

## Alternatives considered

<!-- Optional — include when the conversation weighed at least one alternative and said why it
lost. One subsection per alternative: what it was, in one sentence, then why it lost, as a list
when there are several reasons. When an alternative was partly adopted, say which part. -->

### <the alternative, named>

## Consequences

<!-- Mandatory, with at least one negative. What becomes easier and what becomes harder, and for
whom. For each negative, say whether it is accepted as it is or how it is contained. -->

### Positive

### Negative

## Revisit when

<!-- Optional — include when a reason in the record rests on a fact that can change: a vendor's
limitation, a scale assumption, the size of the team. One bullet per condition that would reopen
the decision, each traceable to a reason stated above. Rejecting a provider's built-in
deduplication because the provider lacks it yields "the storage provider ships per-account
deduplication". -->
