#!/usr/bin/env node
// Source: plugins/skillbox/scripts/doc-check/. The copies under plugins/skillbox/skills/*/scripts/
// are written by `npm run sync`; edit the source, never a copy.
//
// Checks and repairs the repository's docs — every type in TYPES of lib/doc-model.js — and runs
// as the plugin's Stop hook.
// Usage: node doc-check.js <command> [ID ...] [--dry-run]
//   check [ID ...]              every rule, references from code included; exit 1 on an error
//   fix [ID ...]                regenerate indexes, breadcrumbs and pointers, set heading levels,
//                               put sections where they belong, merge back section files that
//                               fit, move the largest sections out of files over the limit; then
//                               check
//   migrate                     move single-file SDDs into folders, turn links to them into ids,
//                               expand short-form references across the repository; then fix
//   lint [ID ...]               content leads for the agent, all warnings: wording that tells
//                               history, copied code, names in backticks the code no longer has,
//                               links that point at nothing
//   refs --changed | <file ...> the sections that changed files, or the given files, cite — and
//                               the KB sections that link them
//   refs --to ID[§x.y]          everything that cites that doc or section
//   next [PREFIX]               the id a new doc takes
//   index                       rewrite each store's index file, <section>.index in the config,
//                               where it no longer matches the docs
//   hook                        the Stop hook: reads the hook input on stdin, checks the docs
//                               changed since HEAD, prints a reply that sends the problems back
//   index-hook                  the start-of-turn hook: reads the hook input on stdin, rewrites
//                               the index files that no longer match the docs, says nothing
//   --dry-run (fix, migrate) prints what would change and writes nothing.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const D = require('./lib/doc-model');

const CONFIG = path.join('.skillbox', 'tickets.json');
const CONFIG_NAME = '.skillbox/tickets.json';
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

// The same two as in the plugin's scripts/lib/fork-graph.js, copied rather than required: a skill
// folder holding this script has to work when it is installed on its own.
class CliError extends Error {}

function runMain(main) {
  try {
    main();
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

function fail(msg) {
  throw new CliError(msg);
}

const posix = (p) => p.split(path.sep).join('/');
const rel = (root, abs) => posix(path.relative(root, abs));

// ---------------------------------------------------------------- repository

// The nearest directory, from start upwards, holding the plugin config.
function findRoot(start) {
  for (let dir = path.resolve(start); ; ) {
    if (fs.existsSync(path.join(dir, CONFIG))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// One kind per doc type whose root the config names, in TYPES order: the type, where its docs
// live, its line limit, and its index file.
function loadConfig(root) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(root, CONFIG), 'utf8'));
  } catch (e) {
    fail(`cannot read ${CONFIG_NAME}: ${e.message}`);
  }
  const kinds = [];
  for (const type of D.TYPES) {
    const docRoot = raw && raw.paths && raw.paths[type.rootKey];
    const own = raw && raw[type.section] ? raw[type.section] : {};
    const maxLines = own.maxLines;
    // Resolved and made relative again, so `./docs/sdd`, `docs\sdd/` and `docs/sdd` all compare
    // equal to the paths git and the walk report, on every platform.
    const given = typeof docRoot === 'string' ? docRoot.trim().replace(/\\/g, '/') : '';
    if (!given) continue;
    const abs = path.resolve(root, given);
    const rootRel = rel(root, abs);
    kinds.push({
      type,
      rootRel,
      rootAbs: abs,
      maxLines: Number.isInteger(maxLines) && maxLines > 0 ? maxLines : null,
      maxLinesRaw: maxLines,
      index: indexConfig(root, type, rootRel, own.index),
    });
  }
  return { root, kinds };
}

const INDEX_NAME = 'index.generated.md';
const SUMMARY_MODES = ['paragraph', 'sentence', 'none'];

// What <section>.index asks for: { rel, abs, summary, depth }, each key that is left out taking
// its default; null without the key, which turns the index off; { error } when it is malformed.
// The defaults are safe to have because the index is rebuilt from the docs, never edited.
function indexConfig(root, type, rootRel, v) {
  if (v === undefined || v === null || v === false) return null;
  const key = `${type.section}.index`;
  const bad = (msg) => ({ error: `${key} ${msg}` });
  if (typeof v !== 'object' || Array.isArray(v)) {
    return bad(`must be an object such as {"path": "${rootRel ? `${rootRel}/` : ''}${INDEX_NAME}", "summary": "paragraph", "depth": 0}`);
  }
  const given = v.path === undefined ? `${rootRel ? `${rootRel}/` : ''}${INDEX_NAME}` : v.path;
  if (typeof given !== 'string' || !given.trim()) return bad(`has a path that is not a file name: ${JSON.stringify(v.path)}`);
  const abs = path.resolve(root, given.trim().replace(/\\/g, '/'));
  const p = rel(root, abs);
  if (!p || p === '..' || p.startsWith('../')) return bad(`has a path outside the repository: ${given}`);
  // Inside a doc folder the file would be read as part of that doc.
  const segments = p.split('/');
  if (segments.slice(0, -1).some((s) => D.TYPES.some((t) => t.dirRe.test(s))) || D.TYPES.some((t) => t.flatRe && t.flatRe.test(segments[segments.length - 1]))) {
    return bad(`has a path inside a doc folder, or named like a doc: ${p}`);
  }
  const summary = v.summary === undefined ? 'paragraph' : v.summary;
  if (!SUMMARY_MODES.includes(summary)) return bad(`has summary ${JSON.stringify(v.summary)}; it takes "paragraph", "sentence" or "none"`);
  const depth = v.depth === undefined ? 0 : v.depth;
  if (!Number.isInteger(depth) || depth < 0) return bad(`has depth ${JSON.stringify(v.depth)}; it takes 0 for summaries only, or how many section levels to list`);
  return { rel: p, abs, summary, depth };
}

const kindOf = (cfg, prefix) => cfg.kinds.find((k) => k.type.prefix === prefix) || null;
const either = (words) => words.join(' or ');
// Why a reference to a type is not checked: the config names no root for it.
const uncheckedWhy = (prefix) => `${CONFIG_NAME} has no paths.${D.typeOf(prefix).rootKey}`;

function requireRoots(cfg) {
  if (cfg.kinds.length) return;
  const keys = either(D.TYPES.map((t) => `paths.${t.rootKey}`));
  const skills = either(D.TYPES.map((t) => t.skill));
  fail(`${CONFIG_NAME} has no ${keys}; the ${skills} skill's init sets ${D.TYPES.length === 1 ? 'it' : 'them'}`);
}

// No default: the init writes the limit into the config, so the number in force is visible there.
function requireMaxLines(cfg) {
  for (const k of cfg.kinds) {
    if (k.maxLines) continue;
    const key = `${k.type.section}.maxLines`;
    if (k.maxLinesRaw === undefined) fail(`${CONFIG_NAME} has no ${key}; the ${k.type.skill} skill's init sets it`);
    fail(`${key} in ${CONFIG_NAME} must be a positive whole number, not ${JSON.stringify(k.maxLinesRaw)}`);
  }
}

// git's output, or null when it is missing or exits with a status not in `ok`.
function git(cwd, args, ok = [0], input = undefined) {
  const r = spawnSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return ok.includes(r.status) ? r.stdout : null;
}

// Every file under root that git would commit, untracked ones included. Without git, a walk that
// skips dot-directories and node_modules.
function repoFiles(root) {
  const out = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (out !== null) return [...new Set(out.split('\0').filter(Boolean))].filter((p) => fs.existsSync(path.join(root, p)));
  const found = [];
  const visit = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) visit(p);
      else if (e.isFile()) found.push(rel(root, p));
    }
  };
  visit(root);
  return found;
}

// A path with symlinks resolved, so two spellings of one directory compare equal.
function realpath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

// Files changed since HEAD, untracked included, relative to root. null without git. withOld adds
// the path a renamed file had, which what still names the old path may point at.
function changedFiles(root, { withOld = false } = {}) {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  const out = git(root, ['status', '--porcelain', '-z', '--untracked-files=all']);
  if (top === null || out === null) return null;
  const parts = out.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    // A rename or copy, in the index (R ) or the worktree ( R), is followed by its old path.
    if (/[RC]/.test(entry.slice(0, 2))) {
      i++;
      if (withOld && /R/.test(entry.slice(0, 2)) && parts[i]) files.push(parts[i]);
    }
  }
  // git reports the top level with symlinks resolved; root, from the hook's cwd, may not be.
  const base = realpath(root);
  const topAbs = realpath(top.trim());
  return files
    .map((p) => path.resolve(topAbs, p))
    .filter((abs) => !path.relative(base, abs).startsWith('..'))
    .map((abs) => rel(base, abs));
}

// A file's text, or null for one too big or binary to hold references. A NUL byte near the start
// marks a file binary, as it does for git — but not a source file, where one can sit in a string
// literal.
function readText(abs) {
  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    return null;
  }
  if (buf.length > MAX_TEXT_BYTES || (!D.isSourceFile(abs) && buf.subarray(0, 8000).includes(0))) return null;
  return buf.toString('utf8');
}

// ---------------------------------------------------------------- docs

// Every doc under each configured root: folders (SDDnnn-slug/) and, for a type that still has
// them, single files in the old format (SDDnnn-slug.md), which count for numbering and references
// until they are migrated. Roots may be one directory, or one inside another: a doc belongs to the
// type whose prefix its name carries.
function loadDocs(cfg) {
  const docs = [];
  for (const k of cfg.kinds) {
    const { type } = k;
    if (!fs.existsSync(k.rootAbs)) continue;
    for (const e of fs.readdirSync(k.rootAbs, { withFileTypes: true })) {
      const m = (e.isDirectory() && type.dirRe.exec(e.name)) || (e.isFile() && type.flatRe && type.flatRe.exec(e.name));
      if (!m) continue;
      const abs = path.join(k.rootAbs, e.name);
      const files = new Map();
      const eols = new Map();
      const read = (name, file) => {
        const { lines, eol } = D.splitLines(fs.readFileSync(file, 'utf8'));
        files.set(name, lines);
        eols.set(name, eol);
      };
      if (e.isDirectory()) {
        for (const f of fs.readdirSync(abs, { withFileTypes: true })) {
          if (f.isFile() && f.name.endsWith('.md')) read(f.name, path.join(abs, f.name));
        }
      } else {
        read(D.README, abs);
      }
      const num = Number(m[1]);
      docs.push({
        kind: e.isDirectory() ? 'folder' : 'flat',
        type,
        prefix: type.prefix,
        name: e.name,
        abs,
        rel: rel(cfg.root, abs),
        num,
        digits: m[1],
        id: D.docId(type.prefix, num),
        files,
        eols,
        model: D.buildModel(files),
      });
    }
  }
  const rank = (d) => D.TYPES.indexOf(d.type);
  return docs.sort((a, b) => rank(a) - rank(b) || a.num - b.num || a.name.localeCompare(b.name));
}

function byId(docs) {
  const map = new Map();
  for (const d of docs) {
    if (!map.has(d.id)) map.set(d.id, []);
    map.get(d.id).push(d);
  }
  return map;
}

const fileOf = (doc, name) => (doc.kind === 'folder' ? `${doc.rel}/${name}` : doc.rel);
// Docs of the configured types only: a reference to another type cannot be checked.
const kindOfDoc = (cfg, doc) => kindOf(cfg, doc.prefix);

// The files a reference scan reads. With git: those `git grep` finds a prefix and a digit in —
// tracked or untracked, ignored ones excluded, files deleted from the worktree skipped — plus the
// docs' own files, whose bare § references name their own sections. Binaries are listed too, and
// readText drops them: git's own test would also drop a source file with a NUL in a string.
// Without git: every file the walk finds, and the scan reads each to find out.
// The index files are left out: they are generated, and their titles link the docs by path.
function citingFiles(cfg, docs) {
  const patterns = D.TYPES.flatMap((t) => ['-e', `${t.prefix}[0-9]`]);
  const out = git(cfg.root, ['grep', '-lz', '--untracked', ...patterns], [0, 1]); // 1: no match
  const generated = indexFiles(cfg);
  if (out === null) return repoFiles(cfg.root).filter((p) => !generated.has(p));
  const found = new Set(out.split('\0').filter(Boolean));
  for (const d of docs) for (const name of d.files.keys()) found.add(fileOf(d, name));
  return [...found].filter((p) => !generated.has(p)).sort();
}

// SDD011, SDD11, or 11 when only one type is configured, as given on the command line, to the
// docs it names.
function select(cfg, docs, args) {
  if (!args.length) return null;
  const prefixes = D.TYPES.map((t) => t.prefix);
  const want = new Set();
  for (const a of args) {
    const m = new RegExp(`^(${prefixes.join('|')})?(\\d+)$`, 'i').exec(a);
    if (!m) fail(`not an id: ${a}; write it like ${either(prefixes.map((p) => `${p}001`))}`);
    let prefix = m[1] && m[1].toUpperCase();
    if (!prefix) {
      if (cfg.kinds.length !== 1) fail(`ambiguous: ${a}; write ${either(cfg.kinds.map((k) => D.docId(k.type.prefix, Number(m[2]))))}`);
      prefix = cfg.kinds[0].type.prefix;
    }
    const id = D.docId(prefix, Number(m[2]));
    if (!docs.some((d) => d.id === id)) fail(`${id} does not exist`);
    want.add(id);
  }
  return want;
}

// ---------------------------------------------------------------- the store index

// The index files to write, one per path: two types that name the same file share it.
function indexPlan(cfg) {
  const byPath = new Map();
  for (const k of cfg.kinds) {
    if (!k.index || k.index.error) continue;
    if (!byPath.has(k.index.rel)) byPath.set(k.index.rel, { rel: k.index.rel, abs: k.index.abs, kinds: [] });
    byPath.get(k.index.rel).kinds.push(k);
  }
  return [...byPath.values()];
}

const indexFiles = (cfg) => new Set(indexPlan(cfg).map((f) => f.rel));

// A link from an index file to a doc: its README.md, or the file itself for a single-file doc.
// Parentheses are escaped: a folder name may hold them, and the link would end at the first )
function indexLink(file, doc) {
  const target = doc.kind === 'folder' ? path.join(doc.abs, D.README) : doc.abs;
  return posix(path.relative(path.dirname(file.abs), target)).replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'));
}

function indexText(file, docs) {
  const groups = file.kinds.map((k) => ({
    type: k.type,
    rootRel: k.rootRel,
    entries: docs
      .filter((d) => d.type === k.type)
      .map((d) => D.indexEntry(d.model, { id: d.id, link: indexLink(file, d), summary: k.index.summary, depth: k.index.depth })),
  }));
  return D.renderStoreIndex(groups);
}

// "20 SDDs", "3 SDDs and 1 KB page".
function indexCount(file, docs) {
  return file.kinds
    .map((k) => {
      const n = docs.filter((d) => d.type === k.type).length;
      return `${n} ${n === 1 ? k.type.noun : k.type.plural}`;
    })
    .join(' and ');
}

// Writes the text through a temporary file renamed into place, so an agent reading the index at
// that moment never sees half of it. Where the rename is refused — Windows, while another program
// holds the file — the file is written in place.
function writeWhole(abs, text) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  try {
    fs.renameSync(tmp, abs);
  } catch {
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(abs, text);
  }
}

// Rewrites each index file whose text no longer matches the docs: [{ rel, count, written }]. A
// file whose doc roots are all missing is skipped: there is nothing to list yet.
function writeIndexes(cfg, docs) {
  const out = [];
  for (const file of indexPlan(cfg)) {
    if (!file.kinds.some((k) => fs.existsSync(k.rootAbs))) continue;
    const text = indexText(file, docs);
    let old = null;
    try {
      old = fs.readFileSync(file.abs, 'utf8');
    } catch {
      // Not written yet.
    }
    if (old !== text) writeWhole(file.abs, text);
    out.push({ rel: file.rel, count: indexCount(file, docs), written: old !== text });
  }
  return out;
}

// What check says about the index files: a malformed index key, and a file git would commit. An
// index is rebuilt from the docs on every machine, so a committed copy conflicts on merges and
// goes stale wherever no hook rebuilds it.
function indexIssues(cfg) {
  const issues = [];
  for (const k of cfg.kinds) {
    if (k.index && k.index.error) issues.push({ path: CONFIG_NAME, level: 'error', message: k.index.error, fixable: false });
  }
  for (const file of indexPlan(cfg)) {
    const tracked = git(cfg.root, ['ls-files', '--', file.rel]);
    if (tracked === null) continue; // no git
    const at = { path: file.rel, level: 'warning', fixable: false };
    if (tracked.trim()) {
      issues.push({ ...at, message: `the index is committed; it is rebuilt from the docs, so untrack it with \`git rm --cached ${file.rel}\` and add it to .gitignore` });
    } else if (!(git(cfg.root, ['check-ignore', '--no-index', '--', file.rel], [0, 1]) || '').trim()) {
      // check-ignore prints the path when a rule ignores it, and nothing when none does.
      issues.push({ ...at, message: `the index is not git-ignored; it is rebuilt from the docs, so add \`${file.rel}\` to .gitignore` });
    }
  }
  return issues;
}

// ---------------------------------------------------------------- issues

function docIssues(doc, cfg) {
  if (doc.kind === 'flat') {
    return [{ path: doc.rel, level: 'warning', message: `a single-file ${doc.type.noun}: \`migrate\` moves it into a folder`, fixable: false }];
  }
  const issues = D.checkDoc(doc.model, fixCtx(cfg, doc)).map((x) => ({ ...x, path: fileOf(doc, x.file) }));
  if (`${doc.prefix}${doc.digits}` !== doc.id) {
    issues.unshift({ path: doc.rel, level: 'error', message: `the folder name must start with ${doc.id}`, fixable: false });
  }
  return issues;
}

function numberIssues(docs) {
  const issues = [];
  for (const [id, same] of byId(docs)) {
    if (same.length < 2) continue;
    issues.push({
      path: same[1].rel,
      level: 'error',
      message: `two ${same[0].type.plural} are numbered ${id}: ${same.map((d) => d.name).join(' and ')}; renumber the newer one with \`next ${same[0].prefix}\``,
      fixable: false,
      id,
    });
  }
  return issues;
}

// References in the given files, checked against the docs. A doc's own files are taken from the
// docs as loaded rather than read again. Each issue remembers which doc it points at and which
// doc's file it sits in, so a check scoped to some docs can keep only those. A reference to a
// type the config names no root for cannot be checked, and says so in a warning.
function refIssues(cfg, docs, files) {
  const ids = byId(docs);
  const owner = new Map();
  for (const d of docs) for (const [name, lines] of d.files) owner.set(fileOf(d, name), { doc: d, lines });
  const issues = [];
  for (const p of files) {
    const own = owner.get(p);
    let lines;
    if (own) {
      lines = own.lines;
    } else {
      const text = readText(path.join(cfg.root, p));
      if (text === null || !D.HINT_RE.test(text)) continue; // outside a doc, every form carries a prefix and a digit
      lines = D.splitLines(text).lines;
    }
    for (const ref of D.refsInFile(p, lines, { markdown: /\.mdx?$/i.test(p), inDoc: Boolean(own) })) {
      const target = D.refId(ref, own && own.doc);
      const at = { path: p, line: ref.i + 1, fixable: false, target, source: own ? own.doc.id : null };
      if (ref.kind !== 'bare' && ref.kind !== 'noncanonical' && !kindOf(cfg, ref.prefix)) {
        // How it is written can still be wrong: a short form, prose, a link by path.
        const form = !ref.tag && ['short', 'prose', 'link'].includes(ref.kind) ? D.validateRef(ref, ids, null) : null;
        issues.push(form ? { ...at, ...form } : { ...at, level: 'warning', message: `${target} is not checked: ${uncheckedWhy(ref.prefix)}` });
        continue;
      }
      const bad = D.validateRef(ref, ids, own && own.doc);
      if (bad) issues.push({ ...at, ...bad });
    }
  }
  return issues;
}

function collectIssues(cfg, docs, sel, files) {
  const inSel = (id) => !sel || sel.has(id);
  const issues = [];
  for (const d of docs) if (inSel(d.id)) issues.push(...docIssues(d, cfg));
  issues.push(...numberIssues(docs).filter((x) => inSel(x.id)));
  issues.push(...refIssues(cfg, docs, files).filter((x) => !sel || inSel(x.target) || (x.source !== null && inSel(x.source))));
  return issues;
}

// The docs of the configured types, for messages: "SDD docs", "SDD docs and KB pages".
const docsLabel = (kinds) => kinds.map((k) => k.type.docs).join(' and ');

function formatIssue(x) {
  return `${x.path}${x.line ? `:${x.line}` : ''}: ${x.level === 'warning' ? 'warning: ' : ''}${x.message}`;
}

function scriptPath() {
  return posix(path.resolve(__filename));
}

function report(cfg, issues) {
  const errors = issues.filter((x) => x.level === 'error');
  const warnings = issues.length - errors.length;
  for (const x of issues) console.log(formatIssue(x));
  if (!issues.length) {
    console.log(`All ${docsLabel(cfg.kinds)} pass.`);
    return 0;
  }
  const fixable = issues.filter((x) => x.fixable).length;
  console.log('');
  console.log(
    `${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}.` +
      (fixable ? ` fix repairs ${fixable}: node "${scriptPath()}" fix` : ''),
  );
  return errors.length ? 1 : 0;
}

// ---------------------------------------------------------------- commands

// A check scoped to some docs leaves the index files to the full one.
function cmdCheck(cfg, args) {
  requireRoots(cfg);
  requireMaxLines(cfg);
  const docs = loadDocs(cfg);
  const sel = select(cfg, docs, args);
  return report(cfg, [...collectIssues(cfg, docs, sel, citingFiles(cfg, docs)), ...(sel ? [] : indexIssues(cfg))]);
}

// After fix or migrate changed docs: the index files they no longer match, rewritten.
function refreshIndexes(cfg, docs) {
  for (const r of writeIndexes(cfg, docs)) if (r.written) console.log(`${r.rel}: rewritten.`);
}

// What fix and checkDoc need to know about a doc.
function fixCtx(cfg, doc) {
  const { type, maxLines } = kindOfDoc(cfg, doc);
  return { id: doc.id, maxLines, noun: type.noun, lineCites: type.lint.lineCites };
}

// Writes the files that changed, and deletes those fix merged away.
function writeDocFiles(dir, files, before, eol) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, lines] of files) {
    const old = before && before.get(name);
    if (old && old.length === lines.length && old.every((l, i) => l === lines[i])) continue;
    fs.writeFileSync(path.join(dir, name), D.joinLines(lines, eol(name)));
  }
  for (const name of before ? before.keys() : []) {
    if (!files.has(name)) fs.unlinkSync(path.join(dir, name));
  }
}

function cmdFix(cfg, args, dryRun) {
  requireRoots(cfg);
  requireMaxLines(cfg);
  const docs = loadDocs(cfg);
  const sel = select(cfg, docs, args);
  let blocked = false;
  for (const doc of docs) {
    if (doc.kind !== 'folder' || (sel && !sel.has(doc.id))) continue;
    const res = D.fixDoc(doc.files, fixCtx(cfg, doc));
    if (res.blocked) {
      blocked = true;
      console.log(`${doc.id}: not changed. Repair these first, then run fix again:`);
      for (const x of res.blocked) console.log(`  ${formatIssue({ ...x, path: fileOf(doc, x.file) })}`);
      continue;
    }
    if (!res.actions.length) continue;
    console.log(`${doc.id}: ${res.actions.join('; ')}.`);
    if (!dryRun) {
      const eol = doc.eols.get(D.README) || '\n';
      writeDocFiles(doc.abs, res.files, doc.files, (name) => doc.eols.get(name) || eol);
    }
  }
  if (dryRun) {
    console.log('Dry run: nothing written.');
    return blocked ? 1 : 0;
  }
  const after = loadDocs(cfg);
  refreshIndexes(cfg, after);
  console.log('');
  return report(cfg, collectIssues(cfg, after, sel, citingFiles(cfg, after)));
}

// Single-file docs into folders. Only a type with legacyFlat has them: SDDs.
function cmdMigrate(cfg, dryRun) {
  const legacy = D.TYPES.filter((t) => t.legacyFlat);
  if (!legacy.some((t) => kindOf(cfg, t.prefix))) {
    fail(`${CONFIG_NAME} has no ${either(legacy.map((t) => `paths.${t.rootKey}`))}; the ${either(legacy.map((t) => t.skill))} skill's init sets it`);
  }
  requireMaxLines(cfg);
  const docs = loadDocs(cfg);
  const flat = docs.filter((d) => d.kind === 'flat');
  if (!flat.length) {
    console.log('Nothing to migrate: every SDD is already a folder.');
    return 0;
  }
  for (const d of flat) {
    const dir = d.abs.slice(0, -'.md'.length);
    if (fs.existsSync(dir)) fail(`${rel(cfg.root, dir)} already exists, so ${d.rel} cannot move there`);
  }

  // Links to the moving files become plain ids, and short forms are expanded, everywhere.
  const idFor = new Map(flat.map((d) => [d.name, d.id]));
  const edits = new Map();
  let links = 0;
  let shorts = 0;
  for (const p of citingFiles(cfg, docs)) {
    const text = readText(path.join(cfg.root, p));
    if (text === null || !D.HINT_RE.test(text)) continue;
    const { lines, eol, final } = D.splitLines(text);
    const markdown = /\.mdx?$/i.test(p);
    const fenced = markdown ? D.scanFile(p, lines).fenced : [];
    let changed = false;
    const out = lines.map((line, i) => {
      if (fenced[i]) return line;
      let next = line;
      if (markdown) {
        const r = D.rewriteDocLinks(next, (base) => idFor.get(base));
        links += r.count;
        next = r.line;
      }
      const s = D.expandRefs(next, { prefixes: legacy.map((t) => t.prefix) });
      shorts += s.count;
      next = s.line;
      if (next !== line) changed = true;
      return next;
    });
    if (changed) edits.set(p, D.joinLines(out, eol, final));
  }

  const plan = flat.map((d) => {
    const text = edits.has(d.rel) ? edits.get(d.rel) : fs.readFileSync(d.abs, 'utf8');
    edits.delete(d.rel);
    const { lines, eol } = D.splitLines(text);
    const input = new Map([[D.README, lines]]);
    const res = D.fixDoc(input, fixCtx(cfg, d));
    return { doc: d, dir: d.abs.slice(0, -'.md'.length), files: res.blocked ? input : res.files, eol, res };
  });

  for (const { doc, dir, files, res } of plan) {
    const extra = files.size > 1 ? ` and ${files.size - 1} section file${files.size === 2 ? '' : 's'}` : '';
    console.log(`${doc.rel} → ${rel(cfg.root, dir)}/README.md${extra}`);
    if (res.blocked) {
      console.log('  moved as it is; fix stopped on:');
      for (const x of res.blocked) console.log(`    ${x.file}${x.line ? `:${x.line}` : ''}: ${x.message}`);
    } else if (res.actions.length) {
      console.log(`  ${res.actions.join('; ')}`);
    }
  }
  console.log(`Links to single-file SDDs turned into ids: ${links}. References rewritten into the full form: ${shorts}. Other files edited: ${edits.size}.`);
  if (dryRun) {
    for (const p of [...edits.keys()].sort()) console.log(`  would edit ${p}`);
    console.log('Dry run: nothing written.');
    return 0;
  }

  for (const [p, text] of edits) fs.writeFileSync(path.join(cfg.root, p), text);
  for (const { doc, dir, files, eol } of plan) {
    writeDocFiles(dir, files, null, () => eol);
    fs.unlinkSync(doc.abs);
  }
  const after = loadDocs(cfg);
  refreshIndexes(cfg, after);
  console.log('');
  return report(cfg, collectIssues(cfg, after, null, citingFiles(cfg, after)));
}

// Docs keep names the code dropped, so a name found only in one proves nothing. Migrations keep
// the names they delete, so a name found only in one may be gone.
const DOC_FILE_RE = /\.(?:md|mdx|markdown|txt|rst|adoc)$/i;
const MIGRATION_RE = /(?:^|\/)(?:migrations|migrate)\//i;

// Which of the repository's files a path a doc names may be. A path from the repository root must
// be exact. A shorter one, like orders/orders.service.ts, may skip directories, so long as the file
// name matches and the directories it names come in order. A link, resolved from the file it sits
// in, is exact: a file, or a directory holding one.
function pathFinder(files) {
  const all = new Set(files);
  const top = new Set(files.map((f) => f.split('/')[0]));
  const byBase = new Map();
  for (const f of files) {
    const base = f.slice(f.lastIndexOf('/') + 1);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(f);
  }
  const inOrder = (dirs, f) => {
    const parts = f.split('/');
    let k = 0;
    for (const p of parts.slice(0, -1)) if (p === dirs[k]) k++;
    return k === dirs.length;
  };
  const segments = new Set(files.flatMap((f) => f.split('/')));
  const pathFiles = (p) => {
    const parts = p.split('/');
    const same = byBase.get(parts[parts.length - 1]) || [];
    return top.has(parts[0]) ? same.filter((f) => f === p) : same.filter((f) => inOrder(parts.slice(0, -1), f));
  };
  const dirFiles = (p) => files.filter((f) => f.startsWith(`${p}/`) || f.includes(`/${p}/`));
  const linkFiles = (p) => (!p ? files : all.has(p) ? [p] : files.filter((f) => f.startsWith(`${p}/`)));
  return {
    path: (p) => pathFiles(p).length > 0,
    dir: (p) => dirFiles(p).length > 0,
    // A directory may carry a file's name too: app/sitemap.xml/route.ts serves sitemap.xml.
    file: (p) => segments.has(p),
    link: (p) => linkFiles(p).length > 0,
    // The files each would name, for matching against a list of changed ones.
    pathFiles,
    dirFiles,
    linkFiles,
  };
}

// Where a relative link in one of a doc's files points, as a path from the repository root: the
// fragment and query dropped, %-escapes decoded, a leading / taken from the root, the way a
// repository host reads it. null for an empty target.
function linkTarget(cfg, doc, target) {
  let t = target.split('#')[0].split('?')[0];
  try {
    t = decodeURIComponent(t);
  } catch {
    // Left as written: a lone % is a character.
  }
  if (!t) return null;
  const from = doc.kind === 'folder' ? doc.abs : path.dirname(doc.abs);
  return rel(cfg.root, t.startsWith('/') ? path.join(cfg.root, t) : path.resolve(from, t));
}

// A doc's relative links, as names lint and refs look up: { file, i, token, kind: 'link', probe }.
const linkNames = (cfg, doc) =>
  D.docLinks(doc.model)
    .map((l) => ({ file: l.file, i: l.i, token: l.target, kind: 'link', probe: linkTarget(cfg, doc, l.target) }))
    .filter((n) => n.probe !== null);

// Whether a repository path lies under a configured doc root. A root that is the repository
// itself holds everything, so it marks nothing: what is a doc there is told by loadDocs.
const inDocRoot = (cfg, p) => cfg.kinds.some((k) => k.rootRel && (p === k.rootRel || p.startsWith(`${k.rootRel}/`)));

// What lint says about the names in backticks the code no longer has, and the links that point at
// nothing: { ...name, why }. A path or a link is looked up in the repository's file list, minus
// what git ignores, like build output; the match is exact in case, as it is wherever the
// repository is checked out. An identifier is looked up among the words of every text file but
// the doc roots' and the docs, read once for all the names.
function missingNames(cfg, names) {
  const files = repoFiles(cfg.root);
  const has = pathFinder(files);
  const code = new Set();
  const migrations = new Set();
  if (names.some((n) => n.kind === 'name')) {
    for (const p of files) {
      if (inDocRoot(cfg, p) || DOC_FILE_RE.test(p)) continue;
      const text = readText(path.join(cfg.root, p));
      const into = MIGRATION_RE.test(p) ? migrations : code;
      if (text) for (const m of text.matchAll(/[A-Za-z_]\w*/g)) into.add(m[0]);
    }
  }
  const outside = (n) => n.kind === 'link' && (n.probe === '..' || n.probe.startsWith('../'));
  const absent = [...new Set(names.filter((n) => n.kind !== 'name' && !outside(n) && !has[n.kind](n.probe)).map((n) => n.probe))];
  const listed = absent.length ? git(cfg.root, ['check-ignore', '--stdin', '--no-index'], [0, 1], absent.join('\n')) : '';
  const ignored = new Set((listed || '').split(/\r?\n/).filter(Boolean));
  const out = [];
  for (const n of names) {
    if (outside(n)) {
      out.push({ ...n, why: 'points outside the repository' });
    } else if (n.kind === 'link') {
      if (absent.includes(n.probe) && !ignored.has(n.probe)) out.push({ ...n, why: `no ${n.probe} in the repository` });
    } else if (n.kind !== 'name') {
      if (absent.includes(n.probe) && !ignored.has(n.probe)) out.push({ ...n, why: `no such ${n.kind === 'dir' ? 'directory' : 'file'} in the repository` });
    } else if (!code.has(n.probe)) {
      out.push({ ...n, why: migrations.has(n.probe) ? `${n.probe} is only in migrations: check whether one drops it` : `no ${n.probe} in the code` });
    }
  }
  return out;
}

// Leads for a content pass: what lintDoc finds, the names in backticks the code no longer has,
// and the links that point at nothing. All warnings, since each needs a reading to confirm; the
// exit status is 0.
function cmdLint(cfg, args) {
  requireRoots(cfg);
  const docs = loadDocs(cfg);
  const sel = select(cfg, docs, args);
  const mine = docs.filter((d) => !sel || sel.has(d.id));
  const issues = [];
  for (const d of mine) {
    for (const x of D.lintDoc(d.model, d.type.lint)) issues.push({ path: fileOf(d, x.file), line: x.i + 1, level: 'warning', message: x.message });
  }
  const names = mine.flatMap((d) =>
    [...D.codeNames(d.model).filter((n) => d.type.lint.names.includes(n.kind)), ...linkNames(cfg, d)].map((n) => ({ ...n, path: fileOf(d, n.file) })),
  );
  for (const n of missingNames(cfg, names)) {
    const what = n.kind === 'link' ? `the link to ${n.token}` : `\`${n.token}\``;
    issues.push({ path: n.path, line: n.i + 1, level: 'warning', message: `${what}: ${n.why}` });
  }
  issues.sort((a, b) => a.path.localeCompare(b.path, 'en') || a.line - b.line);
  for (const x of issues) console.log(formatIssue(x));
  console.log(
    issues.length
      ? `\n${issues.length} warning${issues.length === 1 ? '' : 's'}: leads, not verdicts. Confirm each against the code before changing the text.`
      : 'Nothing to report.',
  );
  return 0;
}

// The section or doc a listing is about, its title, and where it lives — or why it cannot say.
function describeTarget(cfg, ids, { id, prefix, num, anchor, tag }) {
  const key = `${id}${anchor || tag ? `§${anchor || tag}` : ''}`;
  const doc = (ids.get(id) || [])[0];
  const s = doc && anchor && doc.model.sections.get(anchor);
  const title = s ? s.title : doc && !anchor && !tag ? (doc.model.h1 ? doc.model.h1.text : '') : '';
  console.log(`${key}${title ? `  ${title}` : ''}`);
  if (!kindOf(cfg, prefix)) console.log(`  not checked: ${uncheckedWhy(prefix)}`);
  else if (!doc) console.log('  does not exist');
  else if (tag) console.log(`  ${D.validateRef({ kind: 'full', prefix, num, tag }, ids).message}`);
  else if (anchor && !s) console.log(`  not found in ${doc.rel}`);
  else console.log(`  in ${fileOf(doc, s ? s.file : D.README)}${s ? `:${s.i + 1}` : ''}`);
}

// The sections the given files cite, each with where it lives and who cites it. Files under the
// doc roots are skipped: this is for finding which docs a code change may have made wrong. A
// citation in a non-canonical spelling (SDD1§2) is listed under the id it means, with a note,
// since the doc it names is affected all the same. For a type with linkBack, the sections that
// link one of the files — by a markdown link, or by a path in backticks — are listed too: a
// knowledge-base page may describe our code without the code citing it.
function cmdRefs(cfg, args) {
  requireRoots(cfg);
  if (args[0] === '--to') return cmdRefsTo(cfg, args.slice(1));
  let files;
  if (args.length === 1 && args[0] === '--changed') {
    files = changedFiles(cfg.root, { withOld: true });
    if (files === null) fail('--changed needs git');
  } else if (args.length) {
    files = args.map((a) => rel(cfg.root, path.resolve(a)));
  } else {
    fail('refs needs --changed, --to <ID>, or a list of files');
  }
  const docs = loadDocs(cfg);
  const ids = byId(docs);
  const owned = new Set(docs.flatMap((d) => [...d.files.keys()].map((name) => fileOf(d, name))));
  for (const p of indexFiles(cfg)) owned.add(p);
  const cited = new Map();
  const entry = (id, prefix, num, anchor, tag) => {
    const key = `${id}${anchor || tag ? `§${anchor || tag}` : ''}`;
    if (!cited.has(key)) cited.set(key, { id, prefix, num, anchor, tag, by: [], links: [] });
    return cited.get(key);
  };
  for (const p of files) {
    if (inDocRoot(cfg, p) || owned.has(p)) continue;
    const text = readText(path.join(cfg.root, p));
    if (text === null || !D.HINT_RE.test(text)) continue;
    const { lines } = D.splitLines(text);
    for (const ref of D.refsInFile(p, lines, { markdown: /\.mdx?$/i.test(p), inDoc: false })) {
      const id = D.docId(ref.prefix, ref.num);
      const at = ref.anchor || ref.tag;
      const note = ref.kind === 'noncanonical' ? ` (as ${ref.text}; write ${id}${at ? `§${at}` : ''})` : '';
      entry(id, ref.prefix, ref.num, ref.anchor, ref.tag).by.push(`${p}:${ref.i + 1}${note}`);
    }
  }

  // Links back: the files outside every doc folder — attachments count — against what the pages
  // of a linkBack type link, a deleted file included.
  const inDocFolder = (p) => docs.some((d) => (d.kind === 'folder' ? p.startsWith(`${d.rel}/`) : p === d.rel));
  const targets = new Set(files.filter((p) => !inDocFolder(p)));
  const linking = docs.filter((d) => d.type.linkBack);
  if (targets.size && linking.length) {
    const find = pathFinder([...new Set([...repoFiles(cfg.root), ...targets])]);
    for (const d of linking) {
      const names = [...D.codeNames(d.model).filter((n) => n.kind === 'path' || n.kind === 'dir'), ...linkNames(cfg, d)];
      for (const n of names) {
        const named = n.kind === 'link' ? find.linkFiles(n.probe) : n.kind === 'path' ? find.pathFiles(n.probe) : find.dirFiles(n.probe);
        const anchor = D.sectionAt(d.model, n.file, n.i);
        for (const p of named.filter((f) => targets.has(f))) {
          const line = `${p} (${fileOf(d, n.file)}:${n.i + 1})`;
          const e = entry(d.id, d.prefix, d.num, anchor, null);
          if (!e.links.includes(line)) e.links.push(line);
        }
      }
    }
  }

  if (!cited.size) {
    console.log(`No ${either(D.TYPES.map((t) => t.prefix))} references in those files.`);
    return 0;
  }
  // By doc; within one, the doc itself, then its sections in order, then labels.
  const keys = [...cited.keys()].sort((a, b) => {
    const x = cited.get(a);
    const y = cited.get(b);
    return D.compareIds(x.id, y.id) || Boolean(x.tag) - Boolean(y.tag) || (x.tag ? a.localeCompare(b) : D.compareAnchors(x.anchor || '0', y.anchor || '0'));
  });
  for (const key of keys) {
    const e = cited.get(key);
    describeTarget(cfg, ids, e);
    if (e.by.length) console.log(`  cited by ${e.by.join(', ')}`);
    for (const l of e.links) console.log(`  links ${l}`);
  }
  return 0;
}

// Everything that cites one doc or section: refs --to SDD004§3.2. A section's subsections count,
// and so does a bare § in the doc's own files. `:` stands in for § where § is awkward to type.
function cmdRefsTo(cfg, args) {
  const prefixes = D.TYPES.map((t) => t.prefix);
  const m = args.length === 1 && new RegExp(`^(${prefixes.join('|')})(\\d+)(?:[§:](\\d+(?:\\.\\d+)*))?$`, 'i').exec(args[0]);
  if (!m) fail(`refs --to takes one id, with a section or without: ${prefixes[0]}004§3.2, or ${prefixes[0]}004:3.2`);
  const prefix = m[1].toUpperCase();
  const num = Number(m[2]);
  const id = D.docId(prefix, num);
  const anchor = m[3] || null;
  const docs = loadDocs(cfg);
  const ids = byId(docs);
  const owner = new Map();
  for (const d of docs) for (const [name, lines] of d.files) owner.set(fileOf(d, name), { doc: d, lines });
  const by = [];
  for (const p of citingFiles(cfg, docs)) {
    const own = owner.get(p);
    let lines = own && own.lines;
    if (!lines) {
      const text = readText(path.join(cfg.root, p));
      if (text === null || !D.HINT_RE.test(text)) continue;
      lines = D.splitLines(text).lines;
    }
    for (const ref of D.refsInFile(p, lines, { markdown: /\.mdx?$/i.test(p), inDoc: Boolean(own) })) {
      if (D.refId(ref, own && own.doc) !== id) continue;
      if (anchor && !(ref.anchor === anchor || (ref.anchor && ref.anchor.startsWith(`${anchor}.`)))) continue;
      // A note when the citation is not simply the id asked for: another spelling, or a section
      // below the one asked for, or a section of the doc asked for whole.
      let note = '';
      if (ref.kind !== 'full') note = ` (as ${ref.text})`;
      else if ((ref.anchor || null) !== anchor) note = ` (§${ref.anchor || ref.tag})`;
      by.push(`${p}:${ref.i + 1}${note}`);
    }
  }
  describeTarget(cfg, ids, { id, prefix, num, anchor, tag: null });
  if (!by.length) console.log(`  Nothing cites ${id}${anchor ? `§${anchor}` : ''}.`);
  for (const b of by) console.log(`  cited by ${b}`);
  return 0;
}

// Rewrites the index files that no longer match the docs, and says which.
function cmdIndex(cfg) {
  requireRoots(cfg);
  const bad = cfg.kinds.find((k) => k.index && k.index.error);
  if (bad) fail(`${CONFIG_NAME}: ${bad.index.error}`);
  if (!indexPlan(cfg).length) {
    const keys = either(cfg.kinds.map((k) => `${k.type.section}.index`));
    fail(`${CONFIG_NAME} has no ${keys}; the ${either(cfg.kinds.map((k) => k.type.skill))} skill's init sets it`);
  }
  const written = writeIndexes(cfg, loadDocs(cfg));
  if (!written.length) console.log('No index written: no doc root exists yet.');
  for (const r of written) console.log(`${r.rel}: ${r.count}, ${r.written ? 'rewritten' : 'up to date'}.`);
  return 0;
}

// One more than the highest number any doc of the type has had: on disk, or anywhere in git
// history on any branch, deleted ones included. A number is never reused, because something may
// still cite it. The type is the one prefix given, or the only one configured.
function cmdNext(cfg, args) {
  requireRoots(cfg);
  let kind;
  if (args.length) {
    const t = D.typeOf(String(args[0]).toUpperCase());
    if (!t || args.length > 1) fail(`next takes one of ${either(D.TYPES.map((x) => x.prefix))}`);
    kind = kindOf(cfg, t.prefix);
    if (!kind) fail(`${CONFIG_NAME} has no paths.${t.rootKey}; the ${t.skill} skill's init sets it`);
  } else if (cfg.kinds.length === 1) {
    kind = cfg.kinds[0];
  } else {
    fail(`next needs ${either(cfg.kinds.map((k) => k.type.prefix))}`);
  }
  const { prefix } = kind.type;
  let max = 0;
  for (const d of loadDocs(cfg)) if (d.prefix === prefix) max = Math.max(max, d.num);
  const log = git(cfg.root, ['log', '--all', '--format=', '--name-only', '--', kind.rootRel || '.']);
  if (log) {
    const re = new RegExp(`(?:^|/)${prefix}(\\d{3,})-[^/]*`);
    for (const line of log.split('\n')) {
      const m = re.exec(line.trim());
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  console.log(D.docId(prefix, max + 1));
  return 0;
}

// ---------------------------------------------------------------- hook

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

// The Stop hook. Silent unless a doc folder changed since HEAD breaks a rule; then it prints a
// reply that sends the problems to the agent and keeps it working. It checks only the changed docs
// and the references inside them — references from code are the skills' job, not something to pay
// for at the end of every turn.
//
// Most agents share one end-of-turn hook shape: `cwd` and `stop_hook_active` on stdin, and
// {"decision":"block","reason"} on stdout to send the turn back. Claude Code, Codex and Copilot CLI
// take it on Stop (Copilot also on agentStop), Gemini CLI on AfterAgent, and Cursor for a hook in
// Claude Code's format. Cursor's own `stop` hook differs: workspace_roots instead of cwd,
// loop_count for the loop, followup_message for the reply. Exit 2 would not do: Copilot documents
// only the JSON reply for a stop, and Cursor's own stop ignores it.
function hook(input) {
  const cursor = input.hook_event_name === 'stop';
  // A turn already sent back once may end, and so may one Cursor reports as aborted.
  if (cursor ? input.loop_count > 0 || ['aborted', 'error'].includes(input.status) : input.stop_hook_active) return 0;
  const root = hookRoot(input, cursor);
  if (!root) return 0;
  let cfg;
  try {
    cfg = loadConfig(root);
  } catch {
    return 0;
  }
  if (!cfg.kinds.length) return 0;
  const changed = changedFiles(root);
  if (!changed) return 0;
  // The doc folders changed, by their path from the root, and the kinds they belong to.
  const touched = new Set();
  const touchedKinds = new Set();
  for (const k of cfg.kinds) {
    const prefix = k.rootRel ? `${k.rootRel}/` : '';
    for (const p of changed) {
      if (!p.startsWith(prefix)) continue;
      const [first, ...restParts] = p.slice(prefix.length).split('/');
      if (!restParts.length || !k.type.dirRe.test(first)) continue;
      touched.add(`${prefix}${first}`);
      touchedKinds.add(k);
    }
  }
  if (!touched.size) return 0;
  const kinds = cfg.kinds.filter((k) => touchedKinds.has(k));

  const lines = [];
  const unchecked = kinds.filter((k) => !k.maxLines);
  if (unchecked.length) {
    for (const k of unchecked) {
      lines.push(
        `${k.type.docs} changed, but ${CONFIG_NAME} has no valid ${k.type.section}.maxLines, so they cannot be checked. Run the ${k.type.skill} skill's init to set it.`,
      );
    }
  } else {
    const docs = loadDocs(cfg);
    const mine = docs.filter((d) => d.kind === 'folder' && touched.has(d.rel));
    const mineIds = new Set(mine.map((d) => d.id));
    const issues = [
      ...mine.flatMap((d) => docIssues(d, cfg)),
      ...numberIssues(docs).filter((x) => mineIds.has(x.id)),
      ...refIssues(cfg, docs, mine.flatMap((d) => [...d.files.keys()].map((name) => fileOf(d, name)))),
    ].filter((x) => x.level === 'error');
    if (!issues.length) return 0;
    const ids = [...mineIds];
    const fixable = issues.filter((x) => x.fixable);
    const manual = issues.filter((x) => !x.fixable);
    const runFix = [
      `  node "${scriptPath()}" fix ${ids.join(' ')}`,
      'It rewrites the files, so read again any you still need. It repairs:',
      ...fixable.map((x) => `  ${formatIssue(x)}`),
    ];
    const byHand = manual.map((x) => `  ${formatIssue(x)}`);
    const rules = kinds.map((k) => k.type.prefix).join(' and ');
    lines.push(`${docsLabel(kinds)} changed in this task break the ${rules} rules. Repair them before you finish.`);
    // fix refuses a doc with a structural problem, so those come first when there are any.
    if (!fixable.length) lines.push('', 'Repair by hand:', ...byHand);
    else if (!manual.length) lines.push('', 'Run:', ...runFix);
    else if (manual.some((x) => x.structural)) lines.push('', 'Repair by hand first:', ...byHand, '', 'Then run:', ...runFix);
    else lines.push('', 'Run first:', ...runFix, '', 'Then repair by hand:', ...byHand);
  }
  const reason = lines.join('\n');
  process.stdout.write(`${JSON.stringify(cursor ? { followup_message: reason } : { decision: 'block', reason })}\n`);
  return 0;
}

// The repository a hook runs for: from `cwd`, or, in Cursor's own hooks, from workspace_roots.
function hookRoot(input, cursor) {
  const starts = cursor ? [...(input.workspace_roots || []), process.cwd()] : [input.cwd || process.cwd()];
  return starts.map((dir) => findRoot(dir)).find(Boolean) || null;
}

// The start-of-turn hook. It rewrites the index files that no longer match the docs, so a pull, a
// checkout, a merge, a rebase or an edit made since the last turn shows in the index the agent is
// about to read. It runs before every prompt, so it says nothing — Claude Code adds what a hook
// prints on this event to the agent's context, and other agents may too — and it never blocks the
// prompt: any failure is swallowed, and it always exits 0.
//
// Claude Code and Codex run it on UserPromptSubmit, Copilot CLI on userPromptSubmitted, Gemini CLI
// on BeforeAgent; all send `cwd`. Cursor's own beforeSubmitPrompt sends workspace_roots and
// expects {"continue":true} back.
function indexHook(input) {
  const cursor = input.hook_event_name === 'beforeSubmitPrompt';
  try {
    const root = hookRoot(input, cursor);
    const cfg = root && loadConfig(root);
    if (cfg && indexPlan(cfg).length) writeIndexes(cfg, loadDocs(cfg));
  } catch {
    // A prompt is never held up by the index.
  }
  if (cursor) process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
  return 0;
}

// ---------------------------------------------------------------- main

const USAGE = 'usage: doc-check.js <check|fix|migrate|lint|refs|next|index|hook|index-hook> [ID ...] [--dry-run]';

function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  const dryRun = rest.includes('--dry-run');
  const args = rest.filter((a) => a !== '--dry-run');
  if (cmd === 'hook' || cmd === 'index-hook') {
    // Without input, readStdin would wait on the terminal forever.
    if (process.stdin.isTTY) {
      const event = cmd === 'hook' ? 'Stop' : 'start-of-turn';
      fail(`${cmd} reads the ${event} hook input as JSON on stdin: the agent runs it; to try it by hand, pipe {"cwd":"<repository>"} into it`);
    }
    process.exitCode = cmd === 'hook' ? hook(readStdin()) : indexHook(readStdin());
    return;
  }
  if (!cmd || !['check', 'fix', 'migrate', 'lint', 'refs', 'next', 'index'].includes(cmd)) fail(USAGE);
  const root = findRoot(process.cwd());
  if (!root) fail(`no ${CONFIG_NAME} in this directory or above; the ${either(D.TYPES.map((t) => t.skill))} skill's init creates it`);
  const cfg = loadConfig(root);
  if (cmd === 'check') process.exitCode = cmdCheck(cfg, args);
  else if (cmd === 'fix') process.exitCode = cmdFix(cfg, args, dryRun);
  else if (cmd === 'migrate') process.exitCode = cmdMigrate(cfg, dryRun);
  else if (cmd === 'lint') process.exitCode = cmdLint(cfg, args);
  else if (cmd === 'refs') process.exitCode = cmdRefs(cfg, args);
  else if (cmd === 'index') process.exitCode = cmdIndex(cfg);
  else process.exitCode = cmdNext(cfg, args);
}

if (require.main === module) runMain(main);

module.exports = { findRoot, loadConfig, loadDocs, citingFiles, changedFiles, writeIndexes, hook, indexHook, main };
