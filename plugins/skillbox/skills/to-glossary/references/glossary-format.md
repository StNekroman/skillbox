# Glossary format

The built-in shape of the glossary: one markdown file, a title, one paragraph that frames the
domain, then the entries. A glossary the repository already keeps in a shape of its own keeps it.

## The file

```md
# Glossary

A marketplace where independent shops sell handmade goods. Shops list their goods, buyers order
them, and the platform takes payment and pays the shops out.

## Ordering

**Customer**: A person or a company that places **Orders**. Not every **User** is one.
_Avoid_: client, buyer, account

**Order**: A **Customer**'s request to buy one or more goods from one **Shop**.
_Avoid_: purchase, transaction, basket

## Payments

**Invoice**: A request for payment sent to a **Customer** once a **Shipment** is dispatched.
_Avoid_: bill, payment request

**Payout**: The money the platform transfers to a **Shop** for the **Orders** it fulfilled.
_Avoid_: settlement, withdrawal

## Accounts

**User**: An identity that signs in to the platform. It may act for a **Customer**, a **Shop**, or
neither.
_Avoid_: account, login, member
```

## The parts

- **The title** is `# Glossary`.
- **The paragraph under it** says, in one or two sentences, what the product is and who uses it, in
  words a newcomer understands. Every definition below is read against it. Write it when the file
  is created, from the conversation or the repository's README. When neither says, leave it out
  and ask in the report.
- **A group heading**, `##`, gathers the terms of one area a reader would look up on its own:
  ordering, payments, accounts. Start with no groups. Add them once a flat list mixes areas, and
  move the entries under them in the same run.
- **An entry** is two lines: the term in bold followed by a colon and its definition, then
  `_Avoid_:` and the words not to use, separated by commas. An entry with no words to avoid has
  no `_Avoid_` line. A blank line separates entries.
- **Entries are in alphabetical order** within their group, so a reader finds a term at once and a
  duplicate stands next to its twin.

## Why this shape

An agent greps the file as often as it reads it. `^\*\*Order\*\*` finds an entry with its
definition on the same line, and `_Avoid_` lists every rejected word in the file. Two lines per
entry keep the file short enough to read whole at the start of a session.
