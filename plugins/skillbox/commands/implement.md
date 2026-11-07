---
description: Implement the ticket in a file — decide what has an obvious answer, ask only for real decisions.
argument-hint: "<@ticket-file> [notes]"
---

Implement the ticket in the file named first in the arguments: $ARGUMENTS

The path may carry a leading `@`, and the file's text may already be attached; read it only if it is not. Anything after the path is extra instruction from the user, and wins where it disagrees with the ticket. If no file is named, ask which ticket to implement and stop.

Carry the ticket through to the end: the code, its tests, and whatever the ticket or the repository's own instructions say finishes a task. When the ticket has acceptance criteria or a test matrix, they are the definition of done.

**Answer clear questions yourself.** A question has a clear answer when the ticket, the code, the repository's conventions or a sensible default settles it: which file a change belongs in, what to name something, which existing pattern to follow, how to handle a case the ticket implies but does not spell out. Decide, keep going, and note the decision for the closing summary.

**Ask the user only for real decisions**, the ones that are theirs and change what gets built:

- the ticket and the code contradict each other, or the ticket's premise turns out to be false;
- the ticket leaves a choice open, and the options differ in behaviour, cost or risk that someone will care about;
- the work needs more than the ticket's scope, or something hard to reverse: a migration, a deleted file, a changed public contract, a new dependency.

Ask with AskUserQuestion, one question per decision. The dialog may be all the user sees, so each question states on its own what you found, citing `file:line`, and what has to be chosen. Offer every reasonable way to resolve it as an option, two to four, with the one you recommend first and its label ending in "(Recommended)". Give each option its pros and cons in its description, as `Pros: … Cons: …`, specific to this ticket and this code: what it costs, what it risks, and what it makes easier or harder later. If only one option is reasonable, it is not a real decision, so settle it yourself.

Gather the decisions you can foresee and ask them together, up to four per call, before writing the code they affect, rather than one at a time partway through a change.

End with a short summary: what was done against each acceptance criterion, the decisions you made yourself, so the user can overturn any, and anything left undone and why.
