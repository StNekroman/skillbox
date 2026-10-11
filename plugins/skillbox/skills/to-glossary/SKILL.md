---
name: to-glossary
description: Record the domain terms settled in the current conversation in the repository’s glossary — one name for each concept, what it means, and the words not to use for it — or propose entries drawn from documents the user names. Writes nothing when no term was settled. Use when the user chose, renamed or narrowed a term, asks to add to or build the glossary, or before a ticket, spec or doc uses a newly settled term; do not use for how the code works (to-sdd), for decisions (to-adr), for outside facts (to-kb), or for naming code.
metadata:
  prompt-version: "2026-10-11.1"
---

# Record domain terms

The glossary holds one name for each concept of the product's domain, what the name means, and the words not to use for it. It exists because names drift. Each session, an agent reaches for a new word for a thing that already has one, and the user spends turns getting back on the same page. The repository's agent instructions send every session to the glossary and hold it to its terms. This skill is the only thing that writes it.

A glossary stops drift only while every entry in it is a choice someone made, and while it stays short enough to read in one go. So this skill records settled terms only, and most conversations settle none.

## Order of work

1. **Gather the candidates.** By default, the terms this conversation settled: see `Settled`. When the user asks for terms from documents — a spec, a set of tickets, the repository — read those and collect the concepts they name, with every word they use for each. Hold each candidate against `The bar`.
2. **If none clears it, stop and report.** The repository is not touched and nothing is asked.
3. **Read the configuration**, running its init if needed. See `Configuration`.
4. **Read the glossary in full**, and sort each candidate against it. See `Against the glossary`.
5. **Ask about what is not settled:** candidates drawn from documents, and conflicts with the glossary. Ask in one message, one line per term: the term proposed, its definition, and the words to avoid. Write only what the user confirms.
6. **Write the entries**, in the shape `Shape` picks, by the rules in `Entries`.
7. **Find the words left behind.** See `Words left behind`.
8. **Report.** See `Finish`.

The bar comes before the configuration on purpose. When nothing qualifies, the user must not be asked where to keep a file that will never be written.

## The bar

A candidate qualifies when all three hold:

- **It names a concept of the product's domain:** a thing, a role, a state, an event or an action that the people who use or build the product talk about — an Order, a Tenant, a Run, an archived Space. Not a general programming or infrastructure concept, however much the project uses it: a cache, a retry, a queue, an endpoint. Not a technology, a vendor or a library. Not a module, a class, a table or a field: the glossary says what a thing is, and the code may name it its own way.
- **It is settled**, or it was drawn from documents the user asked for, and is waiting for their yes in step 5. See `Settled`.
- **Someone could get it wrong.** More than one word was in play for it; or the word means something narrower or different here than in everyday use; or the concept is new, and its name exists nowhere yet. A word every reader takes the same way needs no entry.

These fall below the bar, however long the discussion about them ran:

- a word used once, for a thing nobody will name again;
- a name for a field, a column, a parameter, a flag or a constant;
- an abbreviation, or a code identifier;
- a word the documents use that the user did not ask to have collected.

### Settled

A term is settled when the user chose it — picked one of two words, corrected a word, or named a new concept and kept the name — or when it was proposed to them and they agreed. The same holds for a change to a term: a rename, or a meaning the user narrowed or corrected.

A word an agent used and nobody remarked on is not settled. Recording it would make an agent's habit the project's language, which is the drift this skill exists to stop. A question still open when the conversation ended is not settled either.

A term drawn from documents is settled only by the user's yes in step 5. A document shows which words are in use, not which one the project chose.

A term the user names in the request is theirs to decide. Hold it to the bar, and when it falls below, say why and write it only once they confirm.

## Configuration

Read `.skillbox/tickets.json` under the repository root. It supplies `paths.glossary`, the glossary file.

If the file is missing, or it has no `paths.glossary`, run the init in [the configuration reference](references/config.md), then carry on with the request. A path the user names in the request wins for this run. When the init is running anyway, that path is also the answer to its question.

The glossary file itself may not exist yet. The first entry creates it.

## Against the glossary

Read the whole file before writing. Then sort each candidate by what the glossary already has:

| The glossary has | Do this |
|---|---|
| Nothing for the concept, and the word nowhere | A new entry |
| The concept, under the same term | Nothing, unless the conversation narrowed or corrected the meaning: then rewrite the definition |
| The concept, under another term | When the user chose the new word over the old one, it is a rename: the entry takes the new term, and the old one moves to `_Avoid_`. Otherwise the glossary's term stands, and the candidate's word joins its `_Avoid_` list |
| The word, under another entry's `_Avoid_` | A conflict: the user chose a word the glossary rejects. Write it only when the conversation knowingly reversed that choice; otherwise ask |
| The word, as the term of another concept | A conflict: one word, two concepts. Ask which concept keeps the word. The other needs a new name, settled before you write |
| The concept, which the product no longer has | Remove the entry, when the conversation dropped the concept |

Match words whole and ignoring case, in singular and plural.

When you are done, the glossary must not hold two entries for one concept, or one word that is the term of one entry and in the `_Avoid_` list of another.

## Shape

A glossary the repository already keeps in a shape of its own — a table, a definition list, a heading per term — keeps that shape: an entry that looks unlike its neighbours makes the file harder to scan. Otherwise use [the built-in format](references/glossary-format.md), which also says how to start a new file.

Whatever the shape, the rules in `Entries` apply. When the shape has no place for the words to avoid, add them in the nearest form, and say so in the report.

## Entries

- **Define what the thing is, in one or two sentences.** Not what the code does with it, how it is stored, or whether it is built yet. A definition that needs a third sentence is carrying a spec, and a spec belongs in a ticket or an SDD.
- **Make it plain what sets the concept apart** from the one it is easiest to confuse with. A Customer places Orders; a User signs in. Which of the two a person is follows from the definitions.
- **Write another term of the glossary in bold** where a definition uses it, so a reader knows the word is defined: "A request for payment sent to a **Customer** after a **Shipment** is dispatched."
- **List under `_Avoid_` the words that were in play for the concept:** in the conversation, in the documents, in the code. Add a near-synonym nobody used only when an agent would plausibly reach for it — "job" beside Run — and not every word a thesaurus offers. A word used for two concepts, such as "account" for both a Customer and a User, goes under `_Avoid_` in both entries.
- **Take the meaning from the conversation.** A meaning you cannot ground in what the user said, or in a document they confirmed, is a question for them, not a guess. The glossary is read as settled, so a wrong definition does more harm than a missing one.
- **Current state only.** A rename rewrites the entry. No "formerly", no "deprecated", no dates: git holds the history.

### Keep it short

Every session reads the whole file, so its length is paid for on every task. When the glossary passes 200 lines, say so in the report, and name the entries that look below the bar or carry more than a definition. Remove nothing without the user's yes.

## Words left behind

A word that moved to `_Avoid_` is still written in older documents, and the next agent that reads one picks it up again. After writing, search the repository's markdown for each word that joined an `_Avoid_` list in this run, whole and ignoring case, in singular and plural:

```bash
git grep -n -i -w -e '<word>' -e '<words>' -- '*.md'
```

Leave out the glossary itself. In the report, list each file that still uses such a word, with the word. When a word turns up in more than ten files, give the count and the first five.

Do not edit those files. An accepted ADR is never edited, a ticket draft may be in someone's review, and a quoted source must stay as it was received. The user decides what to rewrite.

## Writing style

- Short sentences. Plain words. The user's terms, spelled and capitalised as the user writes them.
- No hedging and no filler. Drop "simply", "just", "obviously", "it should be noted".

## Finish

Report to the user:

- the glossary, as a clickable relative link, and whether this run created it;
- each term added, changed or removed, one line each: the term, and for a change what changed — a rename from the old word, a narrowed meaning, new words to avoid;
- the candidates held below the bar, one clause each, so a wrong call can be corrected in one line;
- the conflicts still open, as questions they can answer in chat;
- the files that still use an avoided word;
- the length warning from `Keep it short`, when it applies.

Do not paste the glossary into chat. The user will open the file.
