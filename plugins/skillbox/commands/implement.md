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

Ask with AskUserQuestion, recommended option first. Gather the decisions you can foresee and ask them together, before writing the code they affect, rather than one at a time partway through a change.

End with a short summary: what was done against each acceptance criterion, the decisions you made yourself, so the user can overturn any, and anything left undone and why.
