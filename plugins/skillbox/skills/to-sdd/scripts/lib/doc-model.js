// Source: plugins/skillbox/scripts/doc-check/. The copies under plugins/skillbox/skills/*/scripts/
// are written by `npm run sync`; edit the source, never a copy.
//
// The document model. A doc is a folder, <PREFIX>nnn-<slug>/, holding README.md — the title, the
// summary, the generated index, and every section not moved out yet — plus one file per
// moved-out section, named for its anchor: 3.md, 3.2.md. A section is a heading that carries its
// anchor, `### §3.2 Title`, so a reference like SDD011§3.2 finds its heading wherever it lives.
// Where a section moved out, the file that holds its parent keeps a pointer in its place: the
// heading as a link to the section's file, `### [§3.2 Title](3.2.md)`, so that file still reads
// in order.
// Every doc type in TYPES shares this format; they differ in where they live and in what lint
// looks for.
//
// Everything here is pure: lines in, issues or new lines out. doc-check.js does the disk and git
// work.

const README = 'README.md';
const SUMMARY_MAX = 500;

// The doc types. A prefix is capitals only and starts no other, so no id can be read as another
// type's. rootKey and section name the config keys, paths.<rootKey> and <section>.maxLines; skill
// is the one whose init sets them. legacyFlat: single-file docs, <PREFIX>nnn-<slug>.md, are still
// loaded, and migrate moves them into folders. linkBack: refs --changed reports the sections that
// link a changed file. lint: which of lint's leads apply, and which kinds of names in backticks
// are looked up (see codeName).
const TYPES = [
  {
    prefix: 'SDD',
    noun: 'SDD',
    plural: 'SDDs',
    docs: 'SDD docs',
    rootKey: 'sddRoot',
    section: 'sdd',
    skill: 'to-sdd',
    legacyFlat: true,
    linkBack: false,
    lint: { history: true, fences: true, labelInTitle: true, lineCites: true, names: ['dir', 'path', 'file', 'name'] },
  },
  // Knowledge-base pages: the world outside the code. Its pages are about other systems, so the
  // names in them are other systems' names, and code samples, timelines and quoted lines are
  // content: of lint's leads only labels in titles and paths missing from the repository apply.
  {
    prefix: 'KBDOC',
    noun: 'KB page',
    plural: 'KB pages',
    docs: 'KB pages',
    rootKey: 'kbRoot',
    section: 'kb',
    skill: 'to-kb',
    legacyFlat: false,
    linkBack: true,
    lint: { history: false, fences: false, labelInTitle: true, lineCites: false, names: ['dir', 'path'] },
  },
].map((t) => ({
  ...t,
  dirRe: new RegExp(`^${t.prefix}(\\d{3,})-[^\\s/\\\\]+$`),
  flatRe: t.legacyFlat ? new RegExp(`^${t.prefix}(\\d{3,})-[^\\s/\\\\]+\\.md$`) : null,
}));

for (const t of TYPES) {
  if (!/^[A-Z]+$/.test(t.prefix)) throw new Error(`doc type prefix ${t.prefix}: capitals only`);
  const other = TYPES.find((u) => u !== t && u.prefix.startsWith(t.prefix));
  if (other) throw new Error(`doc type prefix ${t.prefix} starts ${other.prefix}`);
}

const typeOf = (prefix) => TYPES.find((t) => t.prefix === prefix) || null;
// Longest first, so an alternation tries the longer prefix before one it might start.
const PREFIXES = TYPES.map((t) => t.prefix)
  .sort((a, b) => b.length - a.length)
  .join('|');

// A section number has no leading zeros, so §3.2 has exactly one spelling.
const NUM = '(?:0|[1-9]\\d*)';
const ANCHOR = `${NUM}(?:\\.${NUM})*`;

const SECTION_FILE_RE = new RegExp(`^(${ANCHOR})\\.md$`);
const SECTION_RE = new RegExp(`^§(${ANCHOR})(?:[ \\t]+(.*))?$`);
// A pointer's heading text: one link, labelled with the anchor, to the file named for it. A link
// elsewhere is an ordinary heading, so a pointer fix removes is never anything but a pointer.
const POINTER_RE = new RegExp(`^\\[§(${ANCHOR})(?:[ \\t](?:\\\\.|[^\\]\\\\])*)?\\]\\((${ANCHOR})\\.md\\)$`);
const TITLE_RE = new RegExp(`^((?:${PREFIXES})\\d{3,})[ \\t]+[—–-][ \\t]+(.+)$`);
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE_RE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const LIST_ITEM_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;
const BREADCRUMB_RE = new RegExp(`^> \\[(?:${PREFIXES})\\d`);
// Every form of reference holds a prefix followed by a digit: a line without one cites nothing.
const HINT_RE = new RegExp(`(?:${PREFIXES})\\d`);

// A source file, by its extension, and a citation of one of its lines: orders.service.ts:120, or
// a link to blob/main/orders.service.ts#L120.
const CODE_EXT =
  'c|cc|cjs|cpp|cs|css|go|gradle|h|hpp|html|java|js|json|jsx|kt|kts|less|lua|mjs|php|proto|py|rb|rs|sass|scala|scss|sh|sql|svelte|swift|toml|ts|tsx|vue|xml|ya?ml';
const LINE_CITE_RE = new RegExp(`[\\w.-]+\\.(?:${CODE_EXT})(?::\\d+|#L\\d+)`);
const SOURCE_FILE_RE = new RegExp(`\\.(?:${CODE_EXT})$`, 'i');
const isSourceFile = (name) => SOURCE_FILE_RE.test(name);

// The generated index's markers. Docs written before the checker served more than SDDs carry
// sdd:index; both spellings are read, the new one is written, and since only the lines between
// the markers are compared, an old marker changes only when fix rewrites the doc for a reason
// of its own.
const INDEX_OPEN = '<!-- doc:index — generated by doc-check from the section headings; do not edit -->';
const INDEX_OPEN_RE = /^<!-- (?:sdd|doc):index\b/;
const INDEX_CLOSE = '<!-- /doc:index -->';
const INDEX_CLOSE_RE = /^<!-- \/(?:sdd|doc):index -->$/;

// A label written where a section number belongs: §P6, §A, §03. Lowercase letters alone, §x.y,
// are a placeholder in text about the format, and are left alone.
const TAG = '[A-Za-z0-9](?:[A-Za-z0-9.]*[A-Za-z0-9])?';
const isPlaceholder = (tag) => /^[a-z.]+$/.test(tag);
// What follows a §: a section number, or else a label. The groups are named, and each regex below
// holds ITEM at most once, so a group's name says what it holds whatever comes before it.
const ITEM = `§(?:(?<anchor>${ANCHOR})(?!\\d)|(?<tag>${TAG}))`;

// A reference: SDD011, or SDD011§3.2, standing on its own — SDD001_FLAG and a hash like SDD12abc
// are not references. The digits are captured whole, so a non-canonical spelling (SDD11, SDD0011)
// is caught rather than skipped, and so is a label after the §, SDD013§P6.
const REF_RE = new RegExp(`(?<![A-Za-z0-9_])(?<prefix>${PREFIXES})(?<digits>\\d+)(?:${ITEM}|(?![A-Za-z0-9_]))`, 'g');
const ITEM_AT_RE = new RegExp(`^${ITEM}`);
// Prose: §8.1.2 of SDD006.
const PROSE_RE = new RegExp(
  `(?<![A-Za-z0-9_§.])§(?<anchor>${ANCHOR})(?!\\d)[ \\t]+(?:of|in)[ \\t]+(?<prefix>${PREFIXES})(?<digits>\\d+)(?![A-Za-z0-9_])`,
  'g',
);
// A bare §3.2, which inside a doc's own files means a section of that doc.
const BARE_RE = new RegExp(`(?<![A-Za-z0-9_§.])${ITEM}`, 'g');
// A § straight after an all-caps name or a number cites another document: RFC 9110 §15.
const EXTERNAL_RE = /(?:^|[^A-Za-z0-9_])(?:[A-Z][A-Z0-9-]*[A-Z0-9]|\d+(?:\.\d+)*)[ \t]+$/;
// Short forms, which borrow the document of the reference before them. What joins a list:
// SDD006§2.4.1/§12, SDD013§4.2 and §5.1, SDD017§6.1–§6.2.
const SEP_RE = /^(?:[ \t]*[,/][ \t]*(?:(?:and|or)[ \t]+)?|[ \t]+(?:and|or)[ \t]+|[ \t]*–[ \t]*|-)/;
// A label after a list item, which the list reads past: SDD005§8.6 (dialog), §8.2. One holding a
// § is not a label: in SDD002, SDD013§2.2 (§4.9) cites SDD002's own §4.9.
const LABEL_RE = /^[ \t]+\([^()§\n]*\)/;
// Parentheses straight after a bare id, whose §s are that doc's: SDD001 (esp. §7, §8).
const PAREN_RE = /^[ \t]*\(([^()\n]*)\)/;
// A markdown link, with or without a title, and the anchor written after it, with or without a
// space: [SDD007](SDD007-seo.md)§4.4.1, [SDD014 — ABAC](SDD014-abac.md) §4,
// [notes](../sdd/SDD002-mail/3.md "Mail").
const LINK_RE = new RegExp(
  `\\[([^\\]\\n]*)\\]\\(([^)\\s]+)(?:[ \\t]+(?:"[^"\\n]*"|'[^'\\n]*'))?\\)(?:[ \\t]*(§${ANCHOR}(?!\\d)))?`,
  'g',
);

// ---------------------------------------------------------------- anchors

const docId = (prefix, num) => `${prefix}${String(num).padStart(3, '0')}`;
// An id's prefix and number: SDD011 → { prefix: 'SDD', num: 11 }.
function parseId(id) {
  const m = /^([A-Z]+)(\d+)$/.exec(id);
  return m ? { prefix: m[1], num: Number(m[2]) } : null;
}
// Ids in type order, then by number.
function compareIds(a, b) {
  const x = parseId(a);
  const y = parseId(b);
  const rank = (p) => TYPES.findIndex((t) => t.prefix === p.prefix);
  return rank(x) - rank(y) || x.num - y.num;
}
const ownFile = (anchor) => `${anchor}.md`;
const depthOf = (anchor) => anchor.split('.').length;
// §3 is `##`, §3.2 is `###`, and so on; markdown stops at six.
const levelFor = (anchor) => Math.min(depthOf(anchor) + 1, 6);
const isWithin = (anchor, of) => anchor.startsWith(`${of}.`);

function parentOf(anchor) {
  const i = anchor.lastIndexOf('.');
  return i < 0 ? null : anchor.slice(0, i);
}

// Numeric, part by part: §3.2 before §3.10, and a parent before its children.
function compareAnchors(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

const byAnchor = (a, b) => compareAnchors(a.anchor, b.anchor);

// ---------------------------------------------------------------- lines

// A file's text as lines, remembering its line ending and whether it ended with one, so an
// edited file keeps both.
function splitLines(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const final = lines.length > 1 && lines[lines.length - 1] === '';
  if (final) lines.pop();
  if (lines.length === 1 && lines[0] === '') lines.pop();
  return { lines, eol, final };
}

function joinLines(lines, eol = '\n', final = true) {
  return lines.join(eol) + (final && lines.length ? eol : '');
}

const isBlank = (line) => !line.trim();

// Drops trailing blank lines and thematic breaks: the separators that sat between two sections.
function trimEnd(lines) {
  const out = [...lines];
  while (out.length && (isBlank(out[out.length - 1]) || RULE_RE.test(out[out.length - 1]))) out.pop();
  return out;
}

const sameLines = (a, b) => a.length === b.length && a.every((line, i) => line === b[i]);

// ---------------------------------------------------------------- scanning

// Headings, fenced lines, code fences and the index block of one file. A heading inside a code
// fence is text.
function scanFile(name, lines) {
  const headings = [];
  const fenced = new Array(lines.length).fill(false);
  const fences = [];
  let fence = null;
  let indexOpen = -1;
  let indexClose = -1;
  lines.forEach((line, i) => {
    const f = FENCE_RE.exec(line);
    if (fence) {
      fenced[i] = true;
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) {
        fence = null;
        fences[fences.length - 1].end = i;
      }
      return;
    }
    if (f) {
      fence = f[1];
      fenced[i] = true;
      fences.push({ i, end: lines.length - 1, info: line.trim().slice(f[1].length).trim() });
      return;
    }
    if (indexOpen < 0 && INDEX_OPEN_RE.test(line)) indexOpen = i;
    else if (indexOpen >= 0 && indexClose < 0 && INDEX_CLOSE_RE.test(line.trim())) indexClose = i;
    const h = HEADING_RE.exec(line);
    if (!h) return;
    const text = (h[2] || '').trim();
    const heading = { i, level: h[1].length, text };
    if (text.startsWith('§')) {
      const s = SECTION_RE.exec(text);
      if (s) heading.section = { anchor: s[1], title: (s[2] || '').trim() };
      else heading.malformed = true;
    } else if (text.startsWith('[§')) {
      const p = POINTER_RE.exec(text);
      if (p && p[1] === p[2]) heading.pointer = { anchor: p[1] };
    } else if (/^index$/i.test(text)) {
      heading.isIndex = true;
    }
    headings.push(heading);
  });
  const m = SECTION_FILE_RE.exec(name);
  // anchor: null for README.md, the anchor for a section file, undefined for anything else.
  const anchor = name === README ? null : m ? m[1] : undefined;
  return { name, lines, headings, fenced, fences, indexOpen, indexClose, anchor };
}

// The lines of a file that hold its own text: not fenced code, and not what fix generates — the
// index, the breadcrumb and the pointers.
function textLines(f) {
  const pointers = new Set(f.headings.filter((h) => h.pointer).map((h) => h.i));
  const out = [];
  f.lines.forEach((line, i) => {
    if (f.fenced[i] || pointers.has(i) || (i === 0 && f.anchor && BREADCRUMB_RE.test(line))) return;
    if (f.indexOpen >= 0 && i >= f.indexOpen && i <= Math.max(f.indexClose, f.indexOpen)) return;
    out.push({ i, line });
  });
  return out;
}

// Where a section heading's title starts on its line, after its anchor.
const titleStart = (line, anchor) => line.indexOf(`§${anchor}`) + anchor.length + 1;

// README.md first, then section files in anchor order, then anything else.
function orderFiles(files) {
  const rank = (f) => (f.anchor === null ? 0 : f.anchor === undefined ? 2 : 1);
  return [...files.values()].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 1 ? compareAnchors(a.anchor, b.anchor) : a.name.localeCompare(b.name)),
  );
}

// files: Map of file name to lines.
function buildModel(files) {
  const scanned = new Map();
  for (const [name, lines] of files) scanned.set(name, scanFile(name, lines));
  const sections = new Map();
  const duplicates = [];
  for (const f of orderFiles(scanned)) {
    for (const h of f.headings) {
      if (!h.section) continue;
      const { anchor, title } = h.section;
      const s = { anchor, title, file: f.name, i: h.i, level: h.level, removed: /^\(removed\b/i.test(title) };
      if (sections.has(anchor)) duplicates.push({ first: sections.get(anchor), again: s });
      else sections.set(anchor, s);
    }
  }
  const readme = scanned.get(README);
  const first = readme && readme.headings[0];
  const h1 = first && first.level === 1 ? first : null;
  return { files: scanned, sections, duplicates, h1 };
}

const hasOwnFile = (s) => s.file === ownFile(s.anchor);
const sortedSections = (m) => [...m.sections.values()].sort(byAnchor);

// The first paragraph under the title.
function summaryOf(readme) {
  const h1 = readme.headings[0];
  if (!h1 || h1.level !== 1) return null;
  const { lines } = readme;
  let i = h1.i + 1;
  while (i < lines.length && isBlank(lines[i])) i++;
  const start = i;
  const body = [];
  for (; i < lines.length && !isBlank(lines[i]) && !HEADING_RE.test(lines[i]) && !RULE_RE.test(lines[i]); i++) {
    body.push(lines[i].trim());
  }
  if (!body.length || /^(>|[-*+][ \t]|\d+[.)][ \t]|\||<!--|```|~~~)/.test(body[0])) return null;
  return { i: start, text: body.join(' ') };
}

// The anchor a heading stands for: a section's own, or the one a pointer links.
const anchorOf = (h) => (h.section ? h.section.anchor : h.pointer ? h.pointer.anchor : null);

// Where a section's text ends in its file: at the next heading outside it, a section's or a
// pointer, or at the index.
function rangeEnd(f, s) {
  let end = f.lines.length;
  if (f.indexOpen > s.i) end = f.indexOpen;
  for (const h of f.headings) {
    if (h.i <= s.i || h.i >= end) continue;
    const a = anchorOf(h);
    if ((h.isIndex && f.name === README) || h.malformed || (a && !isWithin(a, s.anchor))) return h.i;
  }
  return end;
}

// Where a pointer's lines end: at the next heading of a section, a pointer or the index, or at the
// index block. Anything before that is under the pointer.
function pointerEnd(f, p) {
  const end = f.indexOpen > p.i ? f.indexOpen : f.lines.length;
  const next = f.headings.find((h) => h.i > p.i && (anchorOf(h) || h.malformed || (h.isIndex && f.name === README)));
  return next && next.i < end ? next.i : end;
}

// ---------------------------------------------------------------- generated lines

const escapeLabel = (s) => s.replace(/[[\]]/g, '\\$&');

// A heading's id, the one GitHub gives it and VS Code's preview gives it too (github-slugger): its
// rendered text, lowercased, with nothing left but letters, marks, digits, connector punctuation,
// spaces and hyphens, and each space made a hyphen. So `§3.2 Retries & backoff` is
// 32-retries--backoff. Characters newer than github-slugger's Unicode data are kept here where it
// drops them; no script these docs are written in has any.
const SLUG_DROP_RE = /[^\p{Alphabetic}\p{M}\p{Nd}\p{Pc} -]/gu;
const isWordChar = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

// Text outside code spans as it renders: no HTML tag, no backslash before an escaped character,
// and no emphasis underscores — a run of them with a word on one side only. Inside a word, or
// between spaces, an underscore is text.
function inlineText(s) {
  const t = s.replace(/<\/?[A-Za-z][^<>\n]*>/g, '');
  let out = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && /[!-/:-@[-`{-~]/.test(t[i + 1] || '')) {
      out += t[++i];
      continue;
    }
    if (t[i] !== '_') {
      out += t[i];
      continue;
    }
    let j = i;
    while (t[j] === '_') j++;
    if (isWordChar(t[i - 1]) === isWordChar(t[j])) out += t.slice(i, j);
    i = j - 1;
  }
  return out;
}

// The text a heading's markdown renders to: a link or an image by its label, a code span's content
// as written, the rest through inlineText. A run of backticks that nothing closes is text.
function headingText(md) {
  let rest = md.replace(/!?\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, '$1');
  let out = '';
  for (;;) {
    const open = /`+/.exec(rest);
    if (!open) return out + inlineText(rest);
    const after = rest.slice(open.index + open[0].length);
    const close = new RegExp(`(?<!\`)${open[0]}(?!\`)`).exec(after);
    out += inlineText(rest.slice(0, open.index));
    if (!close) {
      out += open[0];
      rest = after;
      continue;
    }
    const code = after.slice(0, close.index);
    // A space on each side of a code span's content is padding, not content.
    out += code.startsWith(' ') && code.endsWith(' ') && code.trim() ? code.slice(1, -1) : code;
    rest = after.slice(close.index + close[0].length);
  }
}

const slugOf = (md) => headingText(md).trim().toLowerCase().replace(SLUG_DROP_RE, '').replace(/ /g, '-');

// Every heading's id in one file, by its line: in order, an id already taken getting the next free
// -1, -2, as github-slugger counts them.
function slugsOf(f) {
  const taken = new Map();
  const out = new Map();
  for (const h of f.headings) {
    const base = slugOf(h.text);
    let id = base;
    while (taken.has(id)) {
      taken.set(base, taken.get(base) + 1);
      id = `${base}-${taken.get(base)}`;
    }
    taken.set(id, 0);
    out.set(h.i, id);
  }
  return out;
}

// Every section, nested by depth, each linking its heading: `#<id>` when it is in README.md itself,
// `<file>#<id>` when it is in a section file.
function renderIndex(m) {
  const ids = new Map();
  const idOf = (s) => {
    if (!ids.has(s.file)) ids.set(s.file, slugsOf(m.files.get(s.file)));
    return ids.get(s.file).get(s.i);
  };
  return sortedSections(m).map((s) => {
    const label = escapeLabel(`§${s.anchor} ${s.title}`.trim());
    const file = s.file === README ? '' : s.file;
    return `${'  '.repeat(depthOf(s.anchor) - 1)}- [${label}](${file}#${idOf(s)})`;
  });
}

// What check says of an index that differs from the one fix writes: which entries link nothing,
// when some do.
function staleIndex(cur) {
  const bare = cur.map((line) => new RegExp(`^\\s*- §(${ANCHOR})(?![\\d.])`).exec(line)).filter(Boolean).map((x) => `§${x[1]}`);
  if (!bare.length) return 'the index is out of date';
  const named = bare.length > 3 ? `${bare.slice(0, 3).join(', ')} and ${bare.length - 3} more` : bare.join(', ').replace(/, ([^,]*)$/, ' and $1');
  return `the index is out of date: ${named} ${bare.length === 1 ? 'has' : 'have'} no link`;
}

// The first line of a section file: the doc, then each ancestor section, each linking its file.
// The doc is named by the README's title when that is well-formed, else by its id alone, so the
// crumb always opens with the id — which is how a crumb is told from text above the heading.
function renderBreadcrumb(m, anchor, id) {
  const title = m.h1 && TITLE_RE.test(m.h1.text) ? m.h1.text : id;
  const chain = [`[${escapeLabel(title)}](${README})`];
  const ancestors = [];
  for (let p = parentOf(anchor); p; p = parentOf(p)) ancestors.unshift(p);
  for (const a of ancestors) {
    const s = m.sections.get(a);
    chain.push(`[${escapeLabel(`§${a} ${s ? s.title : ''}`.trim())}](${ownFile(a)})`);
  }
  return `> ${chain.join(' › ')}`;
}

// The heading a section moved out leaves in its place: its own, as a link to its file.
function renderPointer(m, anchor) {
  const s = m.sections.get(anchor);
  const label = `§${anchor} ${s ? s.title : ''}`.trim();
  return `${'#'.repeat(levelFor(anchor))} [${escapeLabel(label)}](${ownFile(anchor)})`;
}

function currentIndex(readme) {
  if (readme.indexOpen < 0 || readme.indexClose < readme.indexOpen) return null;
  return readme.lines.slice(readme.indexOpen + 1, readme.indexClose);
}

// ---------------------------------------------------------------- checks

// Issues for one doc folder. `fixable` ones are what fix repairs; a `structural` one stops fix
// from touching the doc at all, because moving text around it could lose or misplace some. noun
// names the doc in messages; lineCites says whether a line-number citation is an error.
function checkDoc(m, { id, maxLines, noun = 'SDD', lineCites = true }) {
  const issues = [];
  const add = (file, i, message, kind = {}) =>
    issues.push({
      file,
      line: i === undefined || i < 0 ? undefined : i + 1,
      level: kind.warning ? 'warning' : 'error',
      message,
      fixable: Boolean(kind.fixable),
      structural: Boolean(kind.structural),
    });

  const readme = m.files.get(README);
  if (!readme) {
    add(README, undefined, `missing: every ${noun} folder has a README.md entry file`, { structural: true });
  } else {
    const t = m.h1 && TITLE_RE.exec(m.h1.text);
    if (!m.h1) add(README, 0, `must open with the title heading "# ${id} — <title>"`);
    else if (!t) add(README, m.h1.i, `the title heading must read "# ${id} — <title>"`);
    else if (t[1] !== id) add(README, m.h1.i, `the title says ${t[1]}, but the folder is ${id}`);

    const summary = summaryOf(readme);
    if (!summary) {
      add(README, m.h1 ? m.h1.i + 1 : 0, `no summary: open with one paragraph, under the title, saying what this ${noun} covers`);
    } else if (summary.text.length > SUMMARY_MAX) {
      add(README, summary.i, `the summary is ${summary.text.length} characters; the limit is ${SUMMARY_MAX}`);
    }

    if (readme.indexOpen >= 0 && readme.indexClose < 0) {
      add(README, readme.indexOpen, `the index has no closing ${INDEX_CLOSE}`, { structural: true });
    } else {
      const cur = currentIndex(readme);
      if (!cur) add(README, undefined, 'no generated index', { fixable: true });
      else if (!sameLines(cur, renderIndex(m))) add(README, readme.indexOpen, staleIndex(cur), { fixable: true });
    }
  }

  for (const f of orderFiles(m.files)) {
    let enclosing = null;
    for (const h of f.headings) {
      if (h.level === 1 && h !== m.h1) add(f.name, h.i, 'only README.md opens with a level-1 heading, and only once');
      if (h.malformed) {
        add(f.name, h.i, `malformed section heading "${h.text}": write "§<number> <title>", like "§3.2 Retries"`, {
          structural: true,
        });
      } else if (h.section) {
        const { anchor, title } = h.section;
        enclosing = anchor;
        if (!title) add(f.name, h.i, `§${anchor} has no title`);
        const want = levelFor(anchor);
        if (h.level !== want) {
          add(f.name, h.i, `§${anchor} is a level-${h.level} heading; its depth takes ${'#'.repeat(want)}`, { fixable: true });
        }
      } else if (h.pointer || (h.isIndex && f.name === README)) {
        // A heading after a pointer is under the pointer, which is reported below.
        enclosing = null;
      } else if (enclosing && h.level > 1 && h.level <= levelFor(enclosing)) {
        add(
          f.name,
          h.i,
          `the heading "${h.text}" sits at section level inside §${enclosing}: number it, or make it deeper than ${'#'.repeat(levelFor(enclosing))}`,
          { structural: true },
        );
      }
    }
  }

  for (const { first, again } of m.duplicates) {
    add(again.file, again.i, `§${again.anchor} is defined twice; the other is ${first.file}:${first.i + 1}`, { structural: true });
  }

  for (const s of sortedSections(m)) {
    const p = parentOf(s.anchor);
    if (p && !m.sections.has(p)) add(s.file, s.i, `§${s.anchor} has no parent: there is no §${p}`, { structural: true });
  }
  const astray = misplaced(m);
  for (const x of astray) {
    const s = m.sections.get(x.anchor);
    const why = x.ownFile
      ? `§${x.anchor} has its own file, but its parent §${parentOf(x.anchor)} does not; fix moves it into ${x.to}`
      : `§${x.anchor} belongs in ${x.to}, with its parent; fix moves it there`;
    add(s.file, s.i, why, { fixable: true });
  }

  // A section file opens with its breadcrumb, then its own heading. Nothing else goes above.
  for (const f of orderFiles(m.files)) {
    if (f.anchor === null) continue;
    if (f.anchor === undefined) {
      add(f.name, undefined, 'not a section file: a file here is README.md or is named for the section it holds, like 3.2.md');
      continue;
    }
    const first = f.headings.find((h) => h.section || h.malformed);
    if (!first || !first.section || first.section.anchor !== f.anchor) {
      add(f.name, first ? first.i : undefined, `must open with the heading of §${f.anchor}`, { structural: true });
      continue;
    }
    for (let i = 0; i < first.i; i++) {
      if (isBlank(f.lines[i]) || (i === 0 && BREADCRUMB_RE.test(f.lines[i]))) continue;
      add(f.name, i, `text above the §${f.anchor} heading; only the breadcrumb goes there`, { structural: true });
      break;
    }
    const crumb = renderBreadcrumb(m, f.anchor, id);
    if (f.lines[0] !== crumb) {
      add(f.name, 0, BREADCRUMB_RE.test(f.lines[0] || '') ? 'the breadcrumb is out of date' : 'no breadcrumb', { fixable: true });
    }
  }

  // Every section in a file of its own has a pointer in the file that holds its parent, and a
  // pointer stands alone: the text it stands for is in the file it links.
  const { want, held } = pointerHomes(m);
  const pointed = new Set();
  let pointers = 0;
  for (const f of orderFiles(m.files)) {
    for (const h of f.headings) {
      if (!h.pointer) continue;
      const a = h.pointer.anchor;
      const home = want.get(a) || held.get(a);
      let why = null;
      if (!m.sections.has(a)) why = `a pointer to §${a}, which does not exist; fix removes it`;
      else if (!home) why = `a pointer to §${a}, which has no file of its own; fix removes it`;
      else if (home !== f.name) why = `a pointer to §${a} belongs in ${home}, not here; fix removes it`;
      else if (pointed.has(a)) why = `a second pointer to §${a}; fix removes it`;
      else if (f.lines[h.i] !== renderPointer(m, a)) why = `the pointer to §${a} is out of date`;
      if (home === f.name) pointed.add(a);
      if (why) {
        add(f.name, h.i, why, { fixable: true });
        pointers++;
      }
      const end = pointerEnd(f, h);
      for (let i = h.i + 1; i < end; i++) {
        if (isBlank(f.lines[i]) || RULE_RE.test(f.lines[i])) continue;
        add(f.name, i, `text under the pointer to §${a}; a pointer stands alone: move the text into the section's own file, or under a heading of its own`, {
          structural: true,
        });
        break;
      }
    }
  }
  for (const [a, home] of want) {
    if (pointed.has(a)) continue;
    add(home, undefined, `no pointer to §${a}, which is in ${ownFile(a)}; fix adds it`, { fixable: true });
    pointers++;
  }

  // A section file small enough to go back where its parent is. Only on a sound doc: the merge
  // is worked out by building it, which needs every section and every pointer where it belongs.
  if (!astray.length && !pointers && !issues.some((x) => x.structural)) {
    for (const c of mergeCandidates(m, maxLines)) {
      add(c.file, undefined, `§${c.anchor} fits back into ${c.home}, ${c.lines} lines together, within ${packTarget(maxLines)}; fix merges it`, {
        fixable: true,
      });
    }
  }

  for (const f of lineCites ? orderFiles(m.files) : []) {
    for (const { i, line } of textLines(f)) {
      const c = LINE_CITE_RE.exec(line);
      if (c) add(f.name, i, `cites a line number, ${c[0]}: lines move with every change, so cite the symbol`);
    }
  }

  for (const f of orderFiles(m.files)) {
    if (f.lines.length <= maxLines || f.anchor === undefined) continue;
    const owner = f.anchor;
    const inline = inlineChildren(m, f.name, owner);
    const what = `${f.lines.length} lines, over the ${maxLines}-line limit`;
    if (inline.length) {
      add(f.name, undefined, `${what}; fix moves its largest ${owner ? 'subsections' : 'sections'} into their own files`, {
        fixable: true,
      });
    } else if (owner) {
      add(f.name, undefined, `${what}, and §${owner} has no subsections to move out: divide it into nested sections (§${owner}.1, §${owner}.2, …), then run fix`);
    } else {
      add(f.name, undefined, `${what}, and has no sections left to move out: shorten the text above the index`);
    }
  }

  return issues;
}

// The direct subsections still inside a file. owner is null for README.md, whose children are
// the top-level sections.
function inlineChildren(m, fileName, owner) {
  return sortedSections(m).filter((s) => s.file === fileName && s.anchor !== owner && parentOf(s.anchor) === owner);
}

// ---------------------------------------------------------------- layout

// Two-thirds of the limit: where a split stops, and how far a merge may fill a file. A file is
// split only once it is over the limit, and merged into only while it stays within two-thirds, so
// neither undoes the other, and a few lines more or less do not move sections back and forth.
const packTarget = (maxLines) => Math.floor((maxLines * 2) / 3);

// The file that holds a section's parent: where the section goes when it has no file of its own.
function homeOf(m, anchor) {
  const parent = m.sections.get(parentOf(anchor) || '');
  return parent ? parent.file : README;
}

// Where each pointer goes: a section in a file of its own has one in the file that holds its
// parent, README.md for a top-level section. `want` maps each such section to that file. `held`
// does the same for a section whose parent has no file of its own, which misplaced() moves into
// the parent's file: its pointer may stay until then, since the move puts the text in its place,
// but none is needed.
function pointerHomes(m) {
  const want = new Map();
  const held = new Map();
  for (const s of sortedSections(m)) {
    if (!hasOwnFile(s)) continue;
    const p = parentOf(s.anchor);
    const parent = p && m.sections.get(p);
    const home = homeOf(m, s.anchor);
    if ((p && !parent) || !m.files.has(home)) continue;
    (parent && !hasOwnFile(parent) ? held : want).set(s.anchor, home);
  }
  return { want, held };
}

// lines with lines[from, to) replaced by `insert`, set off by one blank line from the text on
// either side, and with no blank line left at either end.
function spliced(lines, from, to, insert) {
  const before = lines.slice(0, from);
  const after = lines.slice(to);
  while (before.length && isBlank(before[before.length - 1])) before.pop();
  while (after.length && isBlank(after[0])) after.shift();
  const out = before;
  for (const part of [insert, after]) {
    if (!part.length) continue;
    if (out.length) out.push('');
    out.push(...part);
  }
  return out;
}

// Where a section, or a pointer to it, goes in a file, in anchor order: before the first section
// or pointer there that comes after it, else after the last one that comes before it.
function placeFor(f, anchor) {
  const marks = f.headings.filter(anchorOf);
  const later = marks.find((h) => compareAnchors(anchorOf(h), anchor) > 0);
  if (later) return later.i;
  const earlier = marks.filter((h) => compareAnchors(anchorOf(h), anchor) < 0).pop();
  return earlier ? rangeEnd(f, { i: earlier.i, anchor: anchorOf(earlier) }) : f.lines.length;
}

// Sections out of place: one written into a file other than its parent's, and one with a file of
// its own while its parent has none. The first kind comes first, so that a section file holds
// nothing but its own section by the time it is merged away.
function misplaced(m) {
  const inline = [];
  const own = [];
  for (const s of sortedSections(m)) {
    const p = parentOf(s.anchor);
    const parent = p && m.sections.get(p);
    if (p && !parent) continue;
    const to = homeOf(m, s.anchor);
    if (!hasOwnFile(s)) {
      if (s.file !== to) inline.push({ anchor: s.anchor, to, ownFile: false });
    } else if (parent && !hasOwnFile(parent)) {
      own.push({ anchor: s.anchor, to, ownFile: true });
    }
  }
  return [...inline, ...own];
}

// A section — with whatever subsections sit inside it — cut from its file and put into `to`: in
// place of its pointer there, or else in anchor order (placeFor). Returns the new lines of both
// files, without changing either. `from` is null when nothing but a breadcrumb would be left: the
// section had the file to itself.
function relocated(m, anchor, to) {
  const s = m.sections.get(anchor);
  const src = m.files.get(s.file);
  const end = rangeEnd(src, s);
  const text = trimEnd(src.lines.slice(s.i, end));
  const left = trimEnd([...src.lines.slice(0, s.i), ...src.lines.slice(end)]);
  const from = left.every((line, i) => isBlank(line) || (i === 0 && BREADCRUMB_RE.test(line))) ? null : left;

  const dest = m.files.get(to);
  const pointer = dest.headings.find((h) => h.pointer && h.pointer.anchor === anchor);
  const at = pointer ? pointer.i : placeFor(dest, anchor);
  return { from, into: spliced(dest.lines, at, pointer ? at + 1 : at, text) };
}

function moveInto(files, m, anchor, to) {
  const s = m.sections.get(anchor);
  const { from, into } = relocated(m, anchor, to);
  if (from) files.set(s.file, from);
  else files.delete(s.file);
  files.set(to, into);
}

// The section files fix merges back, best first: a file with no section files below it, whose
// text fits into the file that holds its parent with that file staying within two-thirds of the
// limit, measured by building the merge. Deepest first, so a subtree folds back up one level at a
// time; then the shortest, so as many go back as fit.
function mergeCandidates(m, maxLines) {
  const target = packTarget(maxLines);
  const sectionFiles = [...m.files.values()].filter((f) => f.anchor);
  const out = [];
  for (const f of sectionFiles) {
    const s = m.sections.get(f.anchor);
    if (!s || !hasOwnFile(s) || sectionFiles.some((g) => isWithin(g.anchor, f.anchor))) continue;
    const home = homeOf(m, f.anchor);
    if (!m.files.has(home)) continue;
    const { into } = relocated(m, f.anchor, home);
    if (into.length <= target) out.push({ anchor: f.anchor, file: f.name, home, lines: into.length, size: f.lines.length });
  }
  return out.sort((a, b) => depthOf(b.anchor) - depthOf(a.anchor) || a.size - b.size || compareAnchors(a.anchor, b.anchor));
}

// The next section to move into a file of its own: the largest subsection still inside a file
// being split. A file starts being split when it goes over the limit, and goes on until it is
// within two-thirds of it — or, when the section's own text alone is longer than that, until it
// is within the limit. `splitting` carries that state from one move to the next.
function nextMove(m, maxLines, splitting) {
  for (const f of orderFiles(m.files)) {
    if (f.anchor === undefined) continue;
    if (f.lines.length > maxLines) splitting.add(f.name);
    if (!splitting.has(f.name)) continue;
    const kids = inlineChildren(m, f.name, f.anchor).map((s) => ({ s, size: rangeEnd(f, s) - s.i }));
    const own = f.lines.length - kids.reduce((n, k) => n + k.size, 0);
    const target = own <= packTarget(maxLines) ? packTarget(maxLines) : maxLines;
    if (f.lines.length <= target || !kids.length) {
      splitting.delete(f.name);
      continue;
    }
    kids.sort((a, b) => b.size - a.size || compareAnchors(a.s.anchor, b.s.anchor));
    return kids[0].s.anchor;
  }
  return null;
}

// Cuts one section, with its subsections, out of its file into <anchor>.md, and leaves its pointer
// in its place. The blank lines and thematic break that closed it stay behind, after the pointer.
function moveOut(files, m, anchor, id) {
  const s = m.sections.get(anchor);
  const f = m.files.get(s.file);
  const name = ownFile(anchor);
  if (files.has(name)) throw new Error(`${name} already exists`);
  const lines = files.get(s.file);
  const text = trimEnd(lines.slice(s.i, rangeEnd(f, s)));
  files.set(s.file, trimEnd(spliced(lines, s.i, s.i + text.length, [renderPointer(m, anchor)])));
  files.set(name, [renderBreadcrumb(m, anchor, id), '', ...text]);
}

// Pointers where pointerHomes puts them: each one rewritten as rendered, removed where it does not
// belong, and added where it is missing, in anchor order (placeFor). `log` collects what changed:
// the pointers added and updated, as `<file> <anchor>`, and how many were removed.
function applyPointers(files, m, log) {
  const { want, held } = pointerHomes(m);
  const pointed = new Set();
  for (const f of m.files.values()) {
    let lines = files.get(f.name);
    const drop = [];
    for (const h of f.headings) {
      if (!h.pointer) continue;
      const a = h.pointer.anchor;
      if ((want.get(a) || held.get(a)) !== f.name || pointed.has(a)) {
        drop.push(h.i);
        continue;
      }
      pointed.add(a);
      const line = renderPointer(m, a);
      if (lines[h.i] === line) continue;
      lines[h.i] = line;
      log.updated.add(`${f.name} ${a}`);
    }
    for (const i of drop.reverse()) lines = spliced(lines, i, i + 1, []);
    files.set(f.name, lines);
    log.removed += drop.length;
  }
  for (const [a, home] of want) {
    if (pointed.has(a)) continue;
    const lines = files.get(home);
    const at = placeFor(scanFile(home, lines), a);
    files.set(home, spliced(lines, at, at, [renderPointer(m, a)]));
    log.added.add(`${home} ${a}`);
  }
}

// ---------------------------------------------------------------- fix

function applyBreadcrumbs(files, m, id) {
  for (const f of m.files.values()) {
    if (!f.anchor) continue;
    const crumb = renderBreadcrumb(m, f.anchor, id);
    const lines = files.get(f.name);
    if (lines[0] === crumb) continue;
    if (BREADCRUMB_RE.test(lines[0] || '')) lines[0] = crumb;
    else if (lines[0] === '') lines.unshift(crumb);
    else lines.unshift(crumb, '');
  }
}

function applyIndex(files, m) {
  const r = m.files.get(README);
  const lines = files.get(README);
  const block = [INDEX_OPEN, ...renderIndex(m), INDEX_CLOSE];
  if (r.indexOpen >= 0) {
    files.set(README, [...lines.slice(0, r.indexOpen), ...block, ...lines.slice(r.indexClose + 1)]);
    return;
  }
  const heading = r.headings.find((h) => h.isIndex);
  if (heading) {
    // An index written by hand: its list items give way to the generated block. Anything else
    // under the heading — a thematic break that closed it, a paragraph — is text, and follows the
    // block, one blank line between paragraphs.
    const after = r.headings.find((h) => h.i > heading.i);
    const end = after ? after.i : lines.length;
    const rest = [];
    for (let i = heading.i + 1; i < end; i++) {
      const line = lines[i];
      if (!r.fenced[i] && LIST_ITEM_RE.test(line)) continue;
      if (!r.fenced[i] && isBlank(line) && (!rest.length || isBlank(rest[rest.length - 1]))) continue;
      rest.push(line);
    }
    while (rest.length && isBlank(rest[rest.length - 1])) rest.pop();
    const body = ['', ...block];
    if (rest.length) body.push('', ...rest);
    if (end < lines.length) body.push('');
    files.set(README, [...lines.slice(0, heading.i + 1), ...body, ...lines.slice(end)]);
    return;
  }
  const first = r.headings.find((h) => h.section);
  if (first) files.set(README, [...lines.slice(0, first.i), '## Index', '', ...block, '', ...lines.slice(first.i)]);
  else files.set(README, [...trimEnd(lines), '', '## Index', '', ...block]);
}

// Everything fix repairs, in one pass: heading levels; then, one at a time, sections out of place,
// section files that fit back, and sections out of files that are too long, in that order, with
// the breadcrumbs, the pointers and the index regenerated before every step, since all three count
// towards a file's lines. Returns the new files and what changed, or the structural issues that
// stopped it.
function fixDoc(input, ctx) {
  const files = new Map([...input].map(([name, lines]) => [name, [...lines]]));
  let m = buildModel(files);
  const blocked = checkDoc(m, ctx).filter((x) => x.structural);
  if (blocked.length) return { files: input, actions: [], blocked };

  const actions = [];
  let levels = 0;
  for (const f of m.files.values()) {
    for (const h of f.headings) {
      if (!h.section || h.level === levelFor(h.section.anchor)) continue;
      files.get(f.name)[h.i] = `${'#'.repeat(levelFor(h.section.anchor))} ${h.text}`;
      levels++;
    }
  }
  if (levels) actions.push(`set ${levels} heading level${levels === 1 ? '' : 's'} from section depth`);

  const placed = new Map();
  const merged = new Map();
  const moved = new Map();
  const note = (map, key, anchor) => map.set(key, [...(map.get(key) || []), anchor]);
  const splitting = new Set();
  // A pointer added or updated, then replaced by its section's text in the same run, is not news.
  const pointers = { added: new Set(), updated: new Set(), removed: 0 };
  const replace = (anchor, to) => {
    moveInto(files, m, anchor, to);
    pointers.added.delete(`${to} ${anchor}`);
    pointers.updated.delete(`${to} ${anchor}`);
  };
  for (;;) {
    m = buildModel(files);
    applyBreadcrumbs(files, m, ctx.id);
    applyPointers(files, buildModel(files), pointers);
    applyIndex(files, buildModel(files));
    m = buildModel(files);
    const [astray] = misplaced(m);
    if (astray) {
      note(placed, astray.to, astray.anchor);
      replace(astray.anchor, astray.to);
      continue;
    }
    const [back] = mergeCandidates(m, ctx.maxLines);
    if (back) {
      note(merged, back.home, back.anchor);
      replace(back.anchor, back.home);
      continue;
    }
    const next = nextMove(m, ctx.maxLines, splitting);
    if (!next) break;
    note(moved, m.sections.get(next).file, next);
    moveOut(files, m, next, ctx.id);
  }
  const list = (anchors) => [...anchors].sort(compareAnchors).map((a) => `§${a}`).join(', ');
  const one = (anchors, single, plural) => (anchors.length === 1 ? single : plural);
  for (const [to, anchors] of placed) actions.push(`moved ${list(anchors)} into ${to}, where ${one(anchors, 'its parent is', 'their parents are')}`);
  for (const [to, anchors] of merged) actions.push(`merged ${list(anchors)} back into ${to}`);
  for (const [from, anchors] of moved) actions.push(`moved ${list(anchors)} out of ${from} into ${one(anchors, 'its own file', 'their own files')}`);
  const tally = [['added', pointers.added.size], ['updated', pointers.updated.size], ['removed', pointers.removed]];
  for (const [verb, n] of tally) if (n) actions.push(`${verb} ${n} pointer${n === 1 ? '' : 's'}`);

  const crumbs = [...input.keys()].filter(
    (name) => SECTION_FILE_RE.test(name) && files.has(name) && files.get(name)[0] !== input.get(name)[0],
  ).length;
  if (crumbs) actions.push(`updated ${crumbs} breadcrumb${crumbs === 1 ? '' : 's'}`);
  const before = input.has(README) ? currentIndex(scanFile(README, input.get(README))) : null;
  const after = currentIndex(m.files.get(README));
  if (!before || !sameLines(before, after)) actions.push('regenerated the index');

  return { files, actions, blocked: null };
}

// ---------------------------------------------------------------- lint

// Leads for a content pass, never errors: each is likely, not certain, to break a Content rule
// of the skill, and the agent reading it decides. English wording only.

// Text that tells history instead of the current state.
const HISTORY_RE = new RegExp(
  [
    '(?<!\\b(?:is|are|was|were|be|been|being|get|gets|got) )\\bused to\\b',
    '\\b(?:previously|formerly|originally|initially|anymore|newly)\\b',
    '\\bno longer\\b(?! than)',
    '\\b(?:was|were|has been|have been|had been) (?:added|changed|deleted|dropped|extended|fixed|introduced|merged|migrated|moved|removed|renamed|replaced|reworked|rewritten|split|switched)\\b',
    '\\b(?:we|they) (?:added|changed|decided|dropped|introduced|moved|removed|renamed|replaced|switched)\\b',
    '(?<!\\b(?:is|are|be|been|being|get|gets|got) )\\breplaced (?:a|an|the)\\b',
    '(?<!\\b(?:is|are|be|been|being|get|gets|got) )\\bbriefly (?:had|was|were|\\w+ed)\\b',
    '\\b(?:was|were|had) briefly\\b',
    '\\b(?:is|are) now\\b',
    '\\bnow (?:also|instead)\\b',
    '\\b(?:has|have) since\\b',
    '\\buntil (?:recently|now)\\b',
    '\\b(?:became|landed)\\b',
    '\\bchanged from\\b',
    '\\bin the past\\b',
    `\\bsince (?:(?:${PREFIXES})\\d+|v?\\d+\\.\\d+|then\\b|the (?:change|migration|refactor|rewrite)\\b)`,
    '\\b(?:before|after) (?:this|the) (?:change|migration|PR|refactor|rewrite)\\b',
    '\\bwhat changed\\b',
    '\\bthe old (?:approach|behaviou?r|code|design|flow|format|implementation|list|name|scheme|version)\\b',
    '^(?:[>*_ \\t]|\\*\\*)*updated?:',
  ].join('|'),
  'i',
);

// Fences that hold a picture or plain text rather than code.
const NON_CODE_FENCES = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'ascii', 'mermaid', 'plantuml', 'puml', 'dot', 'graphviz', 'svgbob', 'math', 'latex', 'tex', 'md', 'markdown', 'console']);

const INLINE_CODE_RE = /`([^`\n]+)`/g;
const FILE_NAME_RE = new RegExp(`^[\\w.-]+\\.(?:${CODE_EXT})$`);
const HOST_RE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

// A line with its code spans and link targets blanked, so their text is not read as wording.
const wording = (line) => line.replace(INLINE_CODE_RE, (s) => ' '.repeat(s.length)).replace(/\]\([^)\s]*\)/g, ']()');

// History wording, code fences and labels in titles, for one doc: { file, i, message }. rules is
// its type's lint, which says which of the three apply.
function lintDoc(m, rules = TYPES[0].lint) {
  const out = [];
  for (const f of orderFiles(m.files)) {
    for (const fence of rules.fences ? f.fences : []) {
      const lang = fence.info.split(/[\s{,]/)[0].toLowerCase();
      if (NON_CODE_FENCES.has(lang)) continue;
      const n = Math.max(0, fence.end - fence.i - 1);
      out.push({ file: f.name, i: fence.i, message: `a ${n}-line \`\`\`${lang} block: copied code goes stale; state the rule it shows and cite the symbol` });
    }
    for (const h of rules.labelInTitle ? f.headings : []) {
      if (!h.section) continue;
      const title = f.lines[h.i].slice(titleStart(f.lines[h.i], h.section.anchor));
      for (const r of findRefs(title, { bare: true })) {
        if (r.kind === 'bare' && r.tag) {
          out.push({ file: f.name, i: h.i, message: `the title carries a label, "§${r.tag}": drop it once no reference cites the label` });
        }
      }
    }
    for (const { i, line } of rules.history ? textLines(f) : []) {
      const h = HISTORY_RE.exec(wording(line));
      if (h) out.push({ file: f.name, i, message: `reads as history, "${h[0].trim()}": state what is true now` });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.i - b.i);
}

// A name in backticks the code should still have, and how to look for it: a path or a file name
// in the repository's file list, an identifier by its last part in the code's text. Only what has
// the shape of code is looked for — a path with an extension, a dotted member, a call, camelCase,
// snake_case. A plain word in backticks is as likely a value or a term.
function codeName(raw) {
  const t = raw.trim().replace(/^@/, '').replace(/^new[ \t]+/, '').replace(/\([^()]*\)$/, '()');
  if (!t || /\s|[*{}<>$=|\\]|:\/\/|x{3}/i.test(t)) return null;
  if (t.includes('/')) {
    // apps/web/.../cart.ts elides directories: what follows the ellipsis is a path from somewhere.
    const segs = t.split('/');
    const cut = Math.max(segs.lastIndexOf('...'), segs.lastIndexOf('…'));
    const parts = segs.slice(cut + 1).filter((p) => p && p !== '.' && p !== '..');
    // A route, /orders/:id, or a URL, api.example.com/v1, is not a file.
    if (!parts.length || t.startsWith('/') || t.includes(':') || (parts.length > 1 && HOST_RE.test(parts[0]))) return null;
    const probe = parts.join('/');
    if (t.endsWith('/')) return { kind: 'dir', probe };
    // a/b without an extension is as often "this or that" as a path.
    return /\.[A-Za-z0-9]+$/.test(probe) ? { kind: 'path', probe } : null;
  }
  if (FILE_NAME_RE.test(t)) return { kind: 'file', probe: t };
  const id = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(\(\))?$/.exec(t);
  if (!id) return null;
  const parts = id[1].split('.');
  const last = parts[parts.length - 1];
  // VARCHAR(500), NOW(): SQL, not a name the code defines.
  if (last.length < 4 || /^_|_$/.test(last) || (id[2] && !/[a-z]/.test(id[1]))) return null;
  const shaped = parts.length > 1 || Boolean(id[2]) || /[a-z][A-Z]|[A-Za-z0-9]_[A-Za-z0-9]/.test(last);
  return shaped ? { kind: 'name', probe: last } : null;
}

// Every name in backticks in one doc's text that codeName would look for: { file, i, token, kind, probe }.
function codeNames(m) {
  const out = [];
  for (const f of orderFiles(m.files)) {
    for (const { i, line } of textLines(f)) {
      for (const c of line.matchAll(INLINE_CODE_RE)) {
        const n = codeName(c[1]);
        if (n) out.push({ file: f.name, i, token: c[1].trim(), ...n });
      }
    }
  }
  return out;
}

// A URL scheme — http:, mailto:, a drive letter — rather than a path.
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

// The relative links in one doc's text: { file, i, target }, target as written. Left out: a URL,
// an in-page #anchor, a protocol-relative //host, and a link into a doc, which check reports as a
// reference by path. Code spans are blanked first, so a link written inside one is text. An
// image's link is a link too.
function docLinks(m) {
  const out = [];
  for (const f of orderFiles(m.files)) {
    for (const { i, line } of textLines(f)) {
      const text = line.replace(INLINE_CODE_RE, (s) => ' '.repeat(s.length));
      for (const l of text.matchAll(LINK_RE)) {
        const target = l[2];
        if (SCHEME_RE.test(target) || target.startsWith('#') || target.startsWith('//') || linkedDoc(target)) continue;
        out.push({ file: f.name, i, target });
      }
    }
  }
  return out;
}

// The section a line of one of a doc's files belongs to: the last section heading at or above it,
// else the section the file holds; null for README.md's text above its first section.
function sectionAt(m, fileName, i) {
  const f = m.files.get(fileName);
  if (!f) return null;
  const h = f.headings.filter((x) => x.section && x.i <= i).pop();
  return h ? h.section.anchor : f.anchor || null;
}

// ---------------------------------------------------------------- references

// A link target's path segments, without its fragment or query.
const targetParts = (target) => target.split('#')[0].split('?')[0].split('/');

// The doc a link target points into — a file (SDD006-order-workflow.md), or a folder, whether
// the link ends on it (../sdd/SDD006-order-workflow) or goes into it (SDD006-order-workflow/3.md):
// { prefix, num }, or null.
function linkedDoc(target) {
  for (const p of targetParts(target)) {
    for (const t of TYPES) {
      const m = (t.flatRe && t.flatRe.exec(p)) || t.dirRe.exec(p);
      if (m) return { prefix: t.prefix, num: Number(m[1]) };
    }
  }
  return null;
}

// The § item starting at `at` — a section number or a label — or null, for none or a placeholder.
function itemAt(line, at) {
  const m = ITEM_AT_RE.exec(line.slice(at));
  const { anchor, tag } = m ? m.groups : {};
  if (!m || (tag && isPlaceholder(tag))) return null;
  return { col: at, anchor: anchor || null, tag: tag || null, text: m[0], end: at + m[0].length };
}

const isExternal = (line, col) => EXTERNAL_RE.test(line.slice(0, col));

// The § items inside parentheses, from `from` to `to`, each with what joins it to the one before
// when that is a slash, so the full form can write a comma there instead.
function itemsWithin(line, from, to, taken) {
  const out = [];
  let prev = null;
  for (const m of line.slice(from, to).matchAll(BARE_RE)) {
    const it = itemAt(line, from + m.index);
    if (!it || taken.has(it.col) || isExternal(line, it.col)) continue;
    const between = prev === null ? null : line.slice(prev, it.col);
    const slash = between !== null && SEP_RE.exec(between)?.[0] === between && between.includes('/');
    out.push({ ...it, withId: true, join: slash ? { from: prev, to: it.col, text: ', ' } : null });
    prev = it.end;
  }
  return out;
}

// The sections a reference lends its document to, read from `p`, just after it: the rest of a
// list, SDD006§2.4.1/§12; parentheses after a bare id, SDD001 (esp. §7, §8); a § after a space,
// SDD007 §8. Each carries the edits that write it in the full form: `withId` puts the id before
// its §, and `join` replaces the text that joined it to the reference before.
function shortForms(line, p, anchored, taken) {
  const out = [];
  const rest = () => line.slice(p);
  if (!anchored) {
    const space = /^[ \t]+(?=§)/.exec(rest());
    const it = space && itemAt(line, p + space[0].length);
    if (!it || taken.has(it.col)) {
      const paren = PAREN_RE.exec(rest());
      if (paren) out.push(...itemsWithin(line, p + paren[0].indexOf('(') + 1, p + paren[0].length - 1, taken));
      return out;
    }
    out.push({ ...it, withId: false, join: { from: p, to: it.col, text: '' } });
    p = it.end;
  }
  for (;;) {
    const label = LABEL_RE.exec(rest());
    if (label) p += label[0].length;
    const sep = SEP_RE.exec(rest());
    const it = sep && itemAt(line, p + sep[0].length);
    if (!it || taken.has(it.col)) break;
    out.push({ ...it, withId: true, join: sep[0].includes('/') ? { from: p, to: it.col, text: ', ' } : null });
    p = it.end;
  }
  return out;
}

// The references on one line. kind: full (SDD011§3.2 or SDD011), noncanonical (SDD11), short (a
// § borrowing the document of the reference before it — see shortForms), prose (§8.1.2 of
// SDD006), link (a markdown link to a doc's file, looked for only when `markdown`), or bare (§3.2
// alone, looked for only when `bare`). Each but a bare one carries the doc's prefix and number. A
// full, short or bare ref with a label where its number belongs, SDD013§P6, has `tag` set and no
// anchor.
function findRefs(line, { bare = false, markdown = false } = {}) {
  const refs = [];
  const taken = new Set();
  const spans = [];
  if (markdown) {
    for (const m of line.matchAll(LINK_RE)) {
      const doc = linkedDoc(m[2]);
      if (!doc) continue;
      const anchor = m[3] ? m[3].slice(1) : null;
      refs.push({ col: m.index, kind: 'link', prefix: doc.prefix, num: doc.num, anchor, text: m[0] });
      spans.push([m.index, m.index + m[0].length]);
      if (anchor) taken.add(m.index + m[0].length - m[3].length);
    }
  }
  for (const m of line.matchAll(PROSE_RE)) {
    const { anchor, prefix, digits } = m.groups;
    refs.push({ col: m.index, kind: 'prose', prefix, num: Number(digits), digits, anchor, text: m[0] });
    taken.add(m.index);
  }
  for (const m of line.matchAll(REF_RE)) {
    if (spans.some(([a, b]) => m.index >= a && m.index < b)) continue;
    if (refs.some((r) => r.kind === 'prose' && m.index > r.col && m.index < r.col + r.text.length)) continue;
    const { prefix, digits, anchor, tag: label } = m.groups;
    const num = Number(digits);
    // The id as written, which a non-canonical spelling makes differ from docId.
    const id = `${prefix}${digits}`;
    const tag = label && !isPlaceholder(label) ? label : null;
    const kind = docId(prefix, num) === id ? 'full' : 'noncanonical';
    const text = label && !tag ? id : m[0];
    refs.push({ col: m.index, kind, prefix, num, anchor: anchor || null, tag, text });
    if (anchor || label) taken.add(m.index + id.length);
    for (const s of shortForms(line, m.index + text.length, Boolean(anchor || tag), taken)) {
      taken.add(s.col);
      refs.push({ ...s, kind: 'short', prefix, num, id, head: text });
    }
  }
  if (bare) {
    for (const m of line.matchAll(BARE_RE)) {
      if (taken.has(m.index) || isExternal(line, m.index)) continue;
      const it = itemAt(line, m.index);
      if (it) refs.push({ col: it.col, kind: 'bare', num: null, anchor: it.anchor, tag: it.tag, text: it.text });
    }
  }
  return refs.sort((a, b) => a.col - b.col);
}

// Every reference in a file, with its line index. In markdown, fenced code is skipped; in a doc's
// own files, so are the lines that define anchors rather than cite them — the index, the
// breadcrumb, a pointer, a section heading's anchor — and a bare §3.2 counts as a reference to
// that doc. A section's title is read for what it cites, (removed; see §3.6) or (SDD013§P6), but a
// bare label in it is where that label is defined, not a citation: lint reports those.
function refsInFile(name, lines, { markdown, inDoc }) {
  const scan = markdown ? scanFile(name, lines) : null;
  const skip = new Set();
  const titles = new Map();
  if (scan) {
    scan.fenced.forEach((f, i) => f && skip.add(i));
    if (inDoc) {
      for (const h of scan.headings) {
        if (h.malformed || h.pointer) skip.add(h.i);
        else if (h.section) titles.set(h.i, titleStart(lines[h.i], h.section.anchor));
      }
      if (scan.indexOpen >= 0) for (let i = scan.indexOpen; i <= Math.max(scan.indexClose, scan.indexOpen); i++) skip.add(i);
      if (BREADCRUMB_RE.test(lines[0] || '')) skip.add(0);
    }
  }
  const out = [];
  lines.forEach((line, i) => {
    if (skip.has(i) || (!HINT_RE.test(line) && !(inDoc && line.includes('§')))) return;
    const from = titles.get(i) || 0;
    for (const ref of findRefs(line.slice(from), { bare: Boolean(inDoc), markdown })) {
      if (from && ref.kind === 'bare' && ref.tag) continue;
      out.push({ i, ...ref, col: ref.col + from });
    }
  });
  return out;
}

// The id a reference points at: its own doc's for a bare one.
const refId = (ref, ownDoc) => (ref.kind === 'bare' ? ownDoc.id : docId(ref.prefix, ref.num));

// What is wrong with one reference, if anything. docsById maps an id to its docs (more than one
// is a numbering clash, reported elsewhere); ownDoc is the doc whose file holds the reference.
function validateRef(ref, docsById, ownDoc) {
  const err = (message) => ({ level: 'error', message });
  if (ref.kind === 'noncanonical') return err(`write ${docId(ref.prefix, ref.num)}, not ${ref.text.replace(/§.*/, '')}`);
  const id = refId(ref, ownDoc);
  const doc = ref.kind === 'bare' ? ownDoc : (docsById.get(id) || [])[0];
  if (ref.tag) return err(doc ? tagMessage(id, ref.tag, doc.model, docsById) : `${id} does not exist`);
  const full = `${id}${ref.anchor ? `§${ref.anchor}` : ''}`;
  if (ref.kind === 'short') return err(`short form: write ${full}, not §${ref.anchor} after ${ref.head}`);
  if (ref.kind === 'prose') return err(`write ${full}, not "${ref.text}"`);
  if (ref.kind === 'link') return err(`a link by file path breaks when the file moves: write ${full}`);
  if (!doc) return err(`${id} does not exist`);
  if (!ref.anchor) return null;
  const s = doc.model.sections.get(ref.anchor);
  if (!s) return err(ref.kind === 'bare' ? `no §${ref.anchor} in ${id}` : `${id} has no §${ref.anchor}`);
  if (s.removed) return { level: 'warning', message: `${id}§${ref.anchor} was removed: ${s.title}` };
  return null;
}

// The sections of one doc whose titles carry a label bare, (§P6). A title carrying SDD013§P6
// cites SDD013's label, and is not where this doc's label is defined.
function carriersOf(model, tag) {
  const re = new RegExp(`(?<![A-Za-z0-9_§.])§${tag.replace(/\./g, '\\.')}(?![A-Za-z0-9])`);
  return sortedSections(model)
    .filter((s) => re.test(s.title))
    .map((s) => `§${s.anchor}`);
}

// A label cited where a number belongs. The sections whose titles carry the label are where it
// likely points, so the message names them — while the headings still carry the labels. When the
// doc it is cited in has none, the docs of its type that do are named instead: a bare label is
// often another doc's. They are candidates, not an answer.
function tagMessage(id, tag, model, docsById) {
  const what = `"§${tag}" is not a section number`;
  const own = carriersOf(model, tag);
  if (own.length === 1) return `${what}; the one heading in ${id} that carries it is ${own[0]}`;
  if (own.length) return `${what}; the headings in ${id} that carry it: ${own.join(', ')}`;
  const { prefix } = parseId(id);
  const elsewhere = [...docsById.keys()]
    .filter((other) => parseId(other).prefix === prefix)
    .sort(compareIds)
    .map((other) => docsById.get(other)[0])
    .filter((d) => d.id !== id)
    .map((d) => [d.id, carriersOf(d.model, tag)])
    .filter(([, found]) => found.length)
    .map(([other, found]) => `${other} (${found.join(', ')})`);
  if (elsewhere.length) return `${what}; no heading in ${id} carries it, but these do: ${elsewhere.join('; ')}`;
  return `${what}, and no heading in ${id} carries it`;
}

// Migration: every reference in the full form. SDD006§2.4.1/§12 becomes SDD006§2.4.1, SDD006§12;
// SDD007 §8 becomes SDD007§8; SDD001 (esp. §7) becomes SDD001 (esp. SDD001§7); and "§8.1.2 of
// SDD006" becomes SDD006§8.1.2.
// prefixes, when given, limits it to those types' references.
function expandRefs(line, { prefixes = null } = {}) {
  const edits = [];
  let count = 0;
  for (const r of findRefs(line)) {
    if (prefixes && !prefixes.includes(r.prefix)) continue;
    if (r.kind === 'prose') {
      edits.push([r.col, r.col + r.text.length, `${r.prefix}${r.digits}§${r.anchor}`]);
    } else if (r.kind === 'short') {
      if (r.withId) edits.push([r.col, r.col, r.id]);
      if (r.join) edits.push([r.join.from, r.join.to, r.join.text]);
    } else {
      continue;
    }
    count++;
  }
  let out = line;
  for (const [from, to, text] of edits.sort((a, b) => b[0] - a[0] || b[1] - a[1])) {
    out = out.slice(0, from) + text + out.slice(to);
  }
  return { line: out, count };
}

// Migration: a markdown link to a single-file SDD becomes its plain id, since the file moves and
// an id never does. [SDD006](SDD006-order-workflow.md)§3.1 becomes SDD006§3.1, and
// [order workflow](SDD006-order-workflow.md) becomes "order workflow (SDD006)".
function rewriteDocLinks(line, idForFile) {
  let count = 0;
  const out = line.replace(LINK_RE, (whole, text, target, anchor = '') => {
    const id = idForFile(targetParts(target).pop());
    if (!id) return whole;
    count++;
    const label = text.trim();
    if (!label || label === id) return `${id}${anchor}`;
    if (!anchor && label.includes(id)) return label;
    return `${label} (${id}${anchor})`;
  });
  return { line: out, count };
}

module.exports = {
  README,
  SUMMARY_MAX,
  TYPES,
  typeOf,
  HINT_RE,
  INDEX_OPEN,
  INDEX_CLOSE,
  docId,
  parseId,
  compareIds,
  refId,
  isSourceFile,
  parentOf,
  compareAnchors,
  levelFor,
  splitLines,
  joinLines,
  scanFile,
  buildModel,
  summaryOf,
  slugOf,
  renderIndex,
  renderBreadcrumb,
  renderPointer,
  checkDoc,
  fixDoc,
  lintDoc,
  codeName,
  codeNames,
  docLinks,
  sectionAt,
  findRefs,
  refsInFile,
  validateRef,
  expandRefs,
  rewriteDocLinks,
};
