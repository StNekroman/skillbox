# draft-ticket

Turns settled research into ticket files a developer can implement without reading the chat that
produced them.

`SKILL.md` is the instruction set, written for the model. This file is the human-facing summary:
what the skill does, when it fires, and what it needs.

## What it produces

One markdown file per deliverable, under `paths.draftRoot` from
[the plugin config](../../CONFIG.md), named `<type>-<slug>.md` — or `<KEY>.md` once the ticket has
a tracker id.

The structure is fixed and mostly optional: only the title, the field list, `Risk if not
implemented` and `Implementation risk` are mandatory. Every other section appears when the research
produced something for it and is left out when it did not. An absent section is information; an
invented one is a false claim a developer will act on.

## When it fires

When chat research has settled enough to be written down. One deliverable becomes one file — four
settled defects become four files, never one merged ticket.

It does **not** touch an issue tracker. Creating, editing, transitioning or commenting on a real
issue is [jira-push-ticket](../jira-push-ticket/README.md)'s job, and the separation is deliberate.

## What it needs

| | |
|---|---|
| Config | `paths.draftRoot`, `domainNotes`, and `jira.site` for citing issues by URL |
| Atlassian MCP | Optional. Used only to verify a cited issue key and read its summary; without it the skill says in its report which keys are unverified |
| Tools | Read and grep. It never runs builds, tests, migrations or lint |

## The rule that matters most

Every statement about how the code behaves today is checked against live code in the session and
cited as `path/to/file.ts:123`. Not from memory, not from an earlier conversation, not carried over
from chat without rechecking. Research notes drift; the file is what a developer will trust.

## Files here

| File | What |
|---|---|
| `SKILL.md` | the instructions |
| `references/ticket-template.md` | the skeleton to copy, with every section and its placeholder |
