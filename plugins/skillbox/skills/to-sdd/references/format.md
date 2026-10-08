# The doc format

The repository keeps two kinds of agent-written doc in one format: SDDs, `SDDnnn`, under
`paths.sddRoot`, and knowledge-base pages, `KBDOCnnn`, under `paths.kbRoot`. Below, `<PREFIX>` is
`SDD` or `KBDOC`, and `<root>` is the matching root.

## The folder

Each doc is a folder, `<root>/<PREFIX>nnn-<slug>/`.

- `<PREFIX>nnn` comes from `next <PREFIX>`. A number is never reused: something may still cite the old one.
- The slug is the title in kebab-case.
- The store's index and the folder listing are how an agent finds a doc, so the title names the area or the topic in the words the code or its readers use: `SDD013-multi-seller-marketplace`, `KBDOC002-nova-poshta-api`.

A new doc starts as a single `README.md`:

```markdown
# <PREFIX>nnn — <Title>

<The summary: one paragraph of at most 500 characters. What this doc covers, and which parts of
the system or of the outside world it spans.>

## §1 <First section>
```

The summary is what the store's index shows for the doc, so an agent picks the doc from it without opening the folder: name the parts of the system or of the outside world it covers in the words a task would use, and say what it does not cover where that is easy to assume. The index is a generated file, never edited and never committed; `fix` rewrites it.

After the summary, the README may hold a few short lines. Then come the sections, and the pointers to the ones in files of their own. `fix` adds the `## Index` block: every section, each entry linking its heading, `#<id>` in `README.md` itself and `<file>#<id>` elsewhere, with the id GitHub and VS Code give the heading. Never edit that block by hand.

### Sections

- **A section is a heading that carries its anchor:** `## §3 Title`, `### §3.2 Title`, `#### §3.2.1 Title`. The heading level follows depth, and `fix` sets it.
- **Every anchor is a heading.** It is never a numbered list item or a bold phrase. A reference like `SDD004§3.6.3` has to find a heading, and `check` reports any anchor that has none.
- **Other headings go deeper than their section.** Inside `### §3.2`, an unnumbered heading is `####` or deeper.
- **A title names the approach, not only the topic.** Write "Retries with exponential backoff and a dead-letter queue", not "Retries". The title is what an agent reads in the index to decide whether to open the section.

### Numbers are frozen; text is not

- **Never renumber a section and never reuse a number.** Code and other docs cite the numbers.
- **Rewrite a section's text in place** whenever it has stopped being true. Never append "Update: now it does X" under text that says otherwise.
- **A new section takes the next free number among its siblings.** Nest it under a section only when it really belongs inside that section. §3.5.1 means "part of §3.5", never "between §3.5 and §3.6".
- **Removing a section:** keep its heading and delete its text. Its title becomes `(removed)`, `(removed; see §3.6)`, or `(removed; see SDD012§2)` when its text moved to another doc. Do the same for each of its subsections. `check` then warns about anything that still cites it.

### Files

`fix` owns the file layout. When a file goes over its type's limit, `sdd.maxLines` or `kb.maxLines`, its largest subsections move into files of their own, named for their anchors (`3.md`, `3.2.md`), until the file is within two-thirds of the limit. The small ones stay with their parent. A section file that would fit back into its parent's file, keeping that file within two-thirds of the limit, is merged back. So a section lives in `<anchor>.md`, or else in the file of its nearest parent section that has one.

Where a section moved out, the file it left keeps a **pointer** in its place: the section's heading as a link to its file, `### [§3.2 Retries with backoff](3.2.md)`. A reader of that file still meets every subsection in order. A pointer holds no text, and it is not the section: the section's heading is in the file it links.

- **Never create, rename, move or merge a section file by hand.** Never edit a breadcrumb, the first line of a section file, or a pointer.
- **Never write under a pointer.** Text there belongs to the section, in the file the pointer links. `check` reports text under a pointer, and `fix` will not run until it is gone.
- **To edit a section,** open the file its pointer or its index entry links, or search the folder for the heading: `^#+ §3\.2 `.
- **To add a section,** write it at the end of its parent's text, after the parent's last subsection or pointer, in the file that holds the parent. For a new top-level section, that is the end of `README.md`. `fix` moves it into a file of its own when the file goes over the limit, and moves it where it belongs if it landed in the wrong file.
- **A section with no subsections can go over the limit,** and `fix` cannot split it. Divide it into nested sections, one heading per part, then run `fix` again.

## References

- **Outside a doc's own files, write the full form every time:** `SDD006§2.4.1`, `KBDOC003§2`. In a list, write `SDD006§2.4.1, SDD006§12`, never `SDD006§2.4.1/§12`. Write `SDD006§8.1.2`, never "§8.1.2 of SDD006" or `SDD006 §8.1.2`. A search for `SDD006§12` has to find every line that cites it.
- **Inside a doc's own files,** a bare `§3.2` means a section of that doc. Another doc takes its id every time, `SDD004§1.3` or `KBDOC002§4`: a bare § right after another doc's reference, in the same list, is read as that doc's section. A document outside the repository keeps its own name, `RFC 9110 §15`, and is not checked.
- **A § is followed by a section number.** A label in its place, such as `SDD013§P6` for a project phase, finds no heading.
- **Never cite a doc by a file path or a markdown link.** The id never moves; a path moves when files split or merge.
- **Docs cite each other freely, and never restate each other.** A fact lives in one section, and a doc that relies on it cites that section: an SDD rule that exists because of an outside constraint cites `KBDOC003§2.1`, and an SDD whose area follows a rule another SDD holds cites `SDD012§2`. A copy goes stale unseen: `refs --to` finds what cites a section when it is corrected, never what repeats it.
