# Repository configuration

This skill reads one file: `.skillbox/tickets.json`, under the root of the repository being worked
in. It is committed, so a team shares one answer.

The file is shared. The `draft-ticket`, `to-adr`, `to-glossary`, `to-sdd`, `to-kb` and
`jira-push-ticket` skills each read it and each fill only the keys they need, so whichever runs
first creates it and the others add to it. Never remove or rewrite a key this skill does not use.
The file is named for the ticket skills; where the glossary lives is one more of the repository's
document paths, so one file answers every path question.

## The key this skill uses

```json
{
  "version": 1,
  "paths": {
    "glossary": "devdoc/glossary.md"
  }
}
```

| Key | Meaning |
|---|---|
| `paths.glossary` | The glossary file, relative to the repository root. It need not exist yet: the skill creates it with the first entry |

Two others read the key. `draft-ticket` names the concepts in a ticket by their terms. And
`doc-check.js` adds the glossary's rules to the block that `to-sdd` and `to-kb` keep in the
agent instructions, which hold every session to the glossary's terms.

## When the file or the key is missing

Do not guess, and do not fall back to defaults. Run this, then continue with the task that was
asked — the init is a step inside the work, not a reason to stop and hand it back.

1. **Find the repository root.** `git rev-parse --show-toplevel`. Create `.skillbox/` there if it
   does not exist, and write the file inside it.
2. **Discover before asking.** The section below says where to look. Propose what you found; ask
   only for what you could not.
3. **Write the key**, leaving the rest of the file untouched, then say in one line what was
   written and that it is meant to be committed.
4. **Settle the agent instructions**, as `The agent instructions` describes, in a run that wrote
   the key.

Fill only this key. Where tickets, ADRs, SDDs or knowledge-base pages go is not this skill's
question.

### `paths.glossary`

Look for a glossary the repository already keeps: a file named `GLOSSARY.md`, `glossary.md`,
`UBIQUITOUS_LANGUAGE.md` or `ubiquitous-language.md`, at the root or in a doc directory — an entry
in `paths.docRoots` included. A `CONTEXT.md` counts only when it reads as a glossary: a list of
the domain's terms, each with a definition. One such file has answered the key itself.

None, or several, means ask where the glossary should go. Propose `glossary.md` beside the
repository's other docs — in the directory that holds `paths.sddRoot`, `paths.kbRoot` or
`paths.adrRoot` when the file has one — or `GLOSSARY.md` at the root when the repository keeps no
doc directory. Do not create the glossary here: the first entry does.

### The agent instructions

A glossary stops drift only when every session reads it, and an agent reads it only when the
repository's always-loaded instructions tell it to. The block that `to-sdd` and `to-kb` keep there
does, once the file has `paths.glossary`. Look for the block in `CLAUDE.md`, `.claude/CLAUDE.md`
and `AGENTS.md`: it runs from a line starting `<!-- skillbox:begin` to `<!-- skillbox:end -->`.

The script is `scripts/doc-check.js` in this skill's folder, run from the repository root:
`node "${CLAUDE_SKILL_DIR}/scripts/doc-check.js" instructions --dry-run`. `${CLAUDE_SKILL_DIR}` is
the folder the skill's `SKILL.md` is in. If it reaches you unexpanded, write that folder's absolute
path in its place.

- **A file holds the block.** `instructions --dry-run` shows the lines that go and the lines that
  come. Show them and ask; on yes, run it without `--dry-run`. These files shape every future
  session in the repository, so never write without the yes.
- **No file holds it.** Leave the files alone. Say in the report that sessions are held to the
  glossary once the `to-sdd` or `to-kb` init has added its block, and that until then only
  `draft-ticket` and this skill read it.

## `.skillbox/` and git

`.skillbox/tickets.json` is committed, because the team shares it. Anything derived,
per-developer or regenerable goes under `.skillbox/cache/`, and the consuming repository should
ignore that one path:

```gitignore
.skillbox/cache/
```

The glossary is committed too: it is the team's language, not a cache. Nothing here holds a
secret, so nothing else needs ignoring. Suggest the `.skillbox/cache/` line when writing the
config into a repository that has no `.skillbox/` yet, rather than ignoring `.skillbox/` wholesale
— that would drop the configuration the team is meant to share.
