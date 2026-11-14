---
description: Take the questions still open in this conversation one at a time, each explained in enough depth to decide it.
argument-hint: "[which questions] [notes]"
---

Walk the user through the questions still open in this conversation, one at a time, explaining each in enough depth to decide it. Arguments, possibly empty: $ARGUMENTS

**Collect the queue.** An open question is one put to the user earlier in this conversation (by a command, a review, a plan, or the user's own list) that they have not answered, or answered with "skip" or "later". If the arguments name certain questions (numbers, a topic, "only the security ones"), take just those; anything else in the arguments is extra instruction. If nothing is open, say so and stop.

Order the queue so each question comes after any other question whose answer would change it. Show the queue first as a numbered list, one line per question, then go straight into the first question in the same message.

**One question per message**, then stop and wait. Ask in the chat, not with AskUserQuestion: the dialog can hide the explanation, and the user may want to ask back before choosing. Write for someone who programs well but is new to this area, and define each term the first time you use it. Make it as long as deciding needs and no longer. Use this shape, and leave out a part that has nothing to add:

```
### Question <n> of <total>: <short title>

**What was found**: …
**Background**: …
**What happens**: …
**Options**
1. **<option> (Recommended)**: … Pros: … Cons: …
2. **<option>**: … Pros: … Cons: …
**Recommendation**: …

Reply with an option number, your own answer, a question, or `skip`.
```

- **What was found**: the finding itself, citing `file:line`.
- **Background**: the concepts and the part of the system the user needs in order to judge it.
- **What happens**: a concrete case. For a bug, steps to reproduce: the input, what happens, what should happen. For a design choice, a use case that shows where the options part ways. Use a short code snippet, or an input with its output, where that says it faster than prose.
- **Options**: two to four ways to resolve it. For each, what changes in practice, then pros and cons specific to this code: what it costs, what it risks, what it makes easier or harder later.
- **Recommendation**: which option and why, in a sentence or two.

**Handle the reply.**

- An option or an answer settles the question. Confirm it in one line and present the next.
- A question back is part of deciding. Answer it and stay on the same question.
- `skip` moves the question to the end of the queue. If it is skipped again there, it stays open.
- When an answer settles a question still in the queue, makes it moot, or changes its options, update the queue and say so in one line.
- A new question that comes up joins the end of the queue.
- `stop` ends the walk early.

Make no code changes while the walk is running unless the user asks for one: a later answer can change an earlier decision.

**When the queue is empty**, or the user stops, list each decision in one line, then any questions still open. If the questions were blocking work the user had already asked for, such as implementing a ticket or fixing review findings, carry on with that work and apply the decisions. Otherwise stop there.
