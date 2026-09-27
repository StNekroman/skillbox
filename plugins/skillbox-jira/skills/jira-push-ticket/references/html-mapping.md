# Markdown to Jira HTML

Every construct a ticket draft uses, and the HTML that carries it into a Jira description.

Author the body as an HTML fragment. No `<html>`, no `<body>`, no wrapping code fence. Pass it with
`contentFormat: "html"`.

## Why not markdown

The MCP accepts markdown and converts it, but the converter loses two things that appear in nearly
every draft:

- **Task lists.** `- [ ] text` arrives as a plain bullet whose text begins with the two characters
  `[ ]`. There is no checkbox.
- **Bold that contains inline code.** `**Binding to the JWT's `salt`.**` arrives with the bold
  ending at the code span, so the closing `.` and anything after it lose their weight.

HTML carries both correctly. Use it for every body.

## The straightforward ones

| Markdown | HTML |
|---|---|
| `## Heading` | `<h2>Heading</h2>` |
| `### Heading` | `<h3>Heading</h3>` |
| paragraph | `<p>text</p>` |
| `- item` | `<ul><li>item</li></ul>` |
| `1. item` | `<ol start="1"><li>item</li></ol>` |
| `**bold**` | `<strong>bold</strong>` |
| `*italic*` | `<em>italic</em>` |
| `` `code` `` | `<code>code</code>` |
| fenced block | `<pre><code class="language-ts">…</code></pre>` |
| `---` | `<hr>` |
| `> quote` | `<blockquote><p>quote</p></blockquote>` |
| `[text](https://…)` | `<a href="https://…">text</a>` |

Tables take a header row:

```html
<table>
  <thead><tr><th>Case</th><th>Expected</th></tr></thead>
  <tbody><tr><td>…</td><td>…</td></tr></tbody>
</table>
```

Do not carry the markdown `|---|---|` separator across. It becomes a data row full of dashes.

## Acceptance criteria

A `- [ ]` list becomes an ADF task list, which renders as checkboxes a reader can tick in Jira:

```html
<ul data-type="task-list">
  <li data-type="task-item"><input type="checkbox"> A newly issued token carries the same <code>exp</code>.</li>
  <li data-type="task-item"><input type="checkbox"> The config no longer declares <code>csrf.maxAge</code>.</li>
</ul>
```

- `checked` on the `<input>` marks an item done. Drafts are unchecked, so omit it.
- Task items hold inline content only. A `<p>` inside one is flattened. For an item that genuinely
  needs paragraphs, use `data-type="block-task-item"` instead.
- Nest a sub-list by putting the nested `<ul data-type="task-list">` after its parent `<li>`, inside
  the same outer list — not inside the `<li>`.

Use this for `Acceptance criteria` and for any other `- [ ]` list in the draft. Never emit the
literal characters `[ ]`.

## Bold that contains inline code

Write the `<strong>` around the whole run, code span included:

```html
<strong>Binding to the JWT's <code>salt</code>.</strong>
```

ADF cannot put the bold mark on a code span, so the converter splits the run and keeps the weight
on the text either side. The stored result is:

```html
<strong>Binding to the JWT's </strong><code>salt</code><strong>.</strong>
```

That is correct and is what the reader sees. Do not pre-split it by hand, and do not drop the bold
to avoid the split.

## Links

| In the draft | In the issue |
|---|---|
| An absolute `http(s)` URL | `<a href="URL">text</a>` |
| A bare URL on its own line | `<a href="URL" data-card-appearance="inline"></a>` — renders a live title and icon |
| A relative repository path | `<code>docs/decisions/ADR-5-…md</code>` |

A relative path is not a link in Jira. `<a href="docs/…">` produces a dead link against the Jira
host. Render the path as inline code and keep the document's title in the surrounding sentence:

```html
<li><code>docs/decisions/ADR-5-agent-token-trust.md</code> — ADR-5: Agent Token Trust at the
API Gateway. Defines <code>skipCsrf</code> and the per-issuer policy.</li>
```

### The one exception: a sibling ticket that already has an id

A draft that has been pushed carries its key in its own file name. A sibling named in ordinary
prose — `PROJ-427.md`, or a file whose field list holds an `Issue` bullet — is a reference to a real
issue, so it becomes a browse URL rather than a code span:

```html
<p>The defect becomes reachable once <a href="https://example.atlassian.net/browse/PROJ-427">PROJ-427</a>
ships and the token is capped to the session's lifetime.</p>
```

A draft with no id yet stays a code span. It becomes a URL when its own push happens, and the phase
that rewrites inbound references will come back and update this one.

Inside `Related tickets`, `Blocks` and `Blocked by` the rule is different: an entry naming a real
issue is not written into the body at all. It leaves the description and becomes a Jira issue link,
and the section goes with it when nothing else is left. See `Phase 3` in the skill. Entries in those
sections naming a draft with no key are ordinary list items and keep the code span.

## Escaping

Inside `<pre><code>` and inside `<code>`, escape the three HTML metacharacters:

| Character | Write |
|---|---|
| `<` | `&lt;` |
| `>` | `&gt;` |
| `&` | `&amp;` |

`this.jwtService.verify<CSRFPayload>(token, {` becomes
`this.jwtService.verify&lt;CSRFPayload&gt;(token, {`. Unescaped, the generic looks like an unknown
tag and the line loses it.

Em dashes, arrows and other punctuation need no escaping. Quotes inside attribute values do.

## Line wrapping

Ticket drafts are hard-wrapped at about 100 columns. Those newlines are an artifact of the file, not
of the prose.

Join each wrapped paragraph into one `<p>`. Do not emit a `<br>` per source line — it produces
ragged short lines in Jira that break again at the reader's own window width.

Keep real line breaks inside `<pre><code>` exactly as the draft has them.

## What Jira refuses

Never author a column layout in a Jira body:

```html
<section data-type="layout-two-equal">…</section>   <!-- refused -->
```

Jira saves an empty field when a description contains one, so the write is rejected outright. Lay
content out as consecutive blocks.

Confluence storage macros — `<ac:structured-macro>`, `<ri:page>`, CDATA — render as raw text. Do
not use them.

## Available when a draft needs them

These are not in the draft template, but they are valid in a Jira body and are worth reaching for
when the content calls for it:

| Construct | HTML |
|---|---|
| Collapsible section | `<details><summary>Title</summary><p>…</p></details>` |
| Callout panel | `<div data-type="panel-warning"><p>…</p></div>` — also `info`, `note`, `success`, `error` |
| Status lozenge | `<span data-type="status" data-color="red">Blocked</span>` |
| Date | `<time datetime="2026-09-21">21 September 2026</time>` |

Panels hold paragraphs, headings, lists, code blocks and rules. They do not hold tables, expands or
other panels.

## Checking the result

Read the issue back with `responseContentFormat: "html"`. A write response echoes markdown, which is
a lossy rendering of what was stored and will show `- [ ]` for a task list that saved correctly.

In a correct read:

- the field list is `<ul><li><p><strong>Type:</strong> <code>Bug</code></p></li>…`;
- acceptance criteria is `<ul data-type="task-list">` with an `<input type="checkbox">` per item;
- code blocks carry `class="language-ts"` and their generics are intact;
- bold runs that surround a code span appear as three nodes, bold-code-bold.
