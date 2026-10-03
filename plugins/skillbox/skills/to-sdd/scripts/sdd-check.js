#!/usr/bin/env node
// Checks and repairs the repository's SDD docs, and runs as the plugin's Stop hook.
// Usage: node <skill>/scripts/sdd-check.js <command> [SDDnnn ...] [--dry-run]
//   check [SDDnnn ...]          every rule, references from code included; exit 1 on an error
//   fix [SDDnnn ...]            regenerate indexes and breadcrumbs, set heading levels, put
//                               sections where they belong, merge back section files that fit,
//                               move the largest sections out of files over the limit; then check
//   migrate                     move single-file SDDs into folders, turn links to them into ids,
//                               expand short-form references across the repository; then fix
//   lint [SDDnnn ...]           content leads for the agent, all warnings: wording that tells
//                               history, copied code, names in backticks the code no longer has
//   refs --changed | <file ...> the SDD sections that changed files, or the given files, cite
//   next                        the id a new SDD takes
//   hook                        the Stop hook: reads the hook input on stdin, checks the SDDs
//                               changed since HEAD, prints a reply that sends the problems back
//   --dry-run (fix, migrate) prints what would change and writes nothing.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const D = require('./lib/sdd-doc');

const CONFIG = path.join('.skillbox', 'tickets.json');
const CONFIG_NAME = '.skillbox/tickets.json';
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

// The same two as in the plugin's scripts/lib/fork-graph.js, copied rather than required: the
// to-sdd skill folder has to work when it is installed on its own.
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

function loadConfig(root) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(root, CONFIG), 'utf8'));
  } catch (e) {
    fail(`cannot read ${CONFIG_NAME}: ${e.message}`);
  }
  const sddRoot = raw && raw.paths && raw.paths.sddRoot;
  const maxLines = raw && raw.sdd ? raw.sdd.maxLines : undefined;
  // Resolved and made relative again, so `./docs/sdd`, `docs\sdd/` and `docs/sdd` all compare
  // equal to the paths git and the walk report, on every platform.
  const given = typeof sddRoot === 'string' ? sddRoot.trim().replace(/\\/g, '/') : '';
  const abs = given ? path.resolve(root, given) : null;
  return {
    root,
    sddRootRel: abs ? rel(root, abs) : null,
    sddRoot: abs,
    maxLines: Number.isInteger(maxLines) && maxLines > 0 ? maxLines : null,
    maxLinesRaw: maxLines,
  };
}

function requireSddRoot(cfg) {
  if (!cfg.sddRoot) fail(`${CONFIG_NAME} has no paths.sddRoot; the to-sdd skill's init sets it`);
}

// No default: the init writes the limit into the config, so the number in force is visible there.
function requireMaxLines(cfg) {
  if (cfg.maxLines) return;
  if (cfg.maxLinesRaw === undefined) fail(`${CONFIG_NAME} has no sdd.maxLines; the to-sdd skill's init sets it`);
  fail(`sdd.maxLines in ${CONFIG_NAME} must be a positive whole number, not ${JSON.stringify(cfg.maxLinesRaw)}`);
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

// Files changed since HEAD, untracked included, relative to root. null without git.
function changedFiles(root) {
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
    if (/[RC]/.test(entry.slice(0, 2))) i++;
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

// Every SDD under sddRoot: folders (SDDnnn-slug/) and single files still in the old format
// (SDDnnn-slug.md), which count for numbering and references until they are migrated.
function loadDocs(cfg) {
  const docs = [];
  if (!cfg.sddRoot || !fs.existsSync(cfg.sddRoot)) return docs;
  for (const e of fs.readdirSync(cfg.sddRoot, { withFileTypes: true })) {
    const m = (e.isDirectory() && D.DOC_DIR_RE.exec(e.name)) || (e.isFile() && D.FLAT_FILE_RE.exec(e.name));
    if (!m) continue;
    const abs = path.join(cfg.sddRoot, e.name);
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
      name: e.name,
      abs,
      rel: rel(cfg.root, abs),
      num,
      digits: m[1],
      id: D.docId(num),
      files,
      eols,
      model: D.buildModel(files),
    });
  }
  return docs.sort((a, b) => a.num - b.num || a.name.localeCompare(b.name));
}

function byNum(docs) {
  const map = new Map();
  for (const d of docs) {
    if (!map.has(d.num)) map.set(d.num, []);
    map.get(d.num).push(d);
  }
  return map;
}

const fileOf = (doc, name) => (doc.kind === 'folder' ? `${doc.rel}/${name}` : doc.rel);

// The files a reference scan reads. With git: those `git grep` finds SDD in — tracked or
// untracked, ignored ones excluded, files deleted from the worktree skipped — plus the SDD files
// themselves, whose bare § references name their own sections. Binaries are listed too, and
// readText drops them: git's own test would also drop a source file with a NUL in a string.
// Without git: every file the walk finds, and the scan reads each to find out.
function citingFiles(cfg, docs) {
  const out = git(cfg.root, ['grep', '-lz', '--untracked', '-e', 'SDD'], [0, 1]); // 1: no match
  if (out === null) return repoFiles(cfg.root);
  const found = new Set(out.split('\0').filter(Boolean));
  for (const d of docs) for (const name of d.files.keys()) found.add(fileOf(d, name));
  return [...found].sort();
}

// SDD011, SDD11 or 11, as given on the command line, to the docs it names.
function select(docs, args) {
  if (!args.length) return null;
  const want = new Set();
  for (const a of args) {
    const m = /^(?:SDD)?(\d+)$/i.exec(a);
    if (!m) fail(`not an SDD id: ${a}`);
    const id = D.docId(Number(m[1]));
    if (!docs.some((d) => d.id === id)) fail(`${id} does not exist`);
    want.add(id);
  }
  return want;
}

// ---------------------------------------------------------------- issues

function docIssues(doc, cfg) {
  if (doc.kind === 'flat') {
    return [{ path: doc.rel, level: 'warning', message: 'a single-file SDD: `migrate` moves it into a folder', fixable: false }];
  }
  const issues = D.checkDoc(doc.model, { id: doc.id, maxLines: cfg.maxLines }).map((x) => ({ ...x, path: fileOf(doc, x.file) }));
  if (`SDD${doc.digits}` !== doc.id) {
    issues.unshift({ path: doc.rel, level: 'error', message: `the folder name must start with ${doc.id}`, fixable: false });
  }
  return issues;
}

function numberIssues(docs) {
  const issues = [];
  for (const [num, same] of byNum(docs)) {
    if (same.length < 2) continue;
    const id = D.docId(num);
    issues.push({
      path: same[1].rel,
      level: 'error',
      message: `two SDDs are numbered ${id}: ${same.map((d) => d.name).join(' and ')}; renumber the newer one with \`next\``,
      fixable: false,
      num,
    });
  }
  return issues;
}

// References in the given files, checked against the docs. An SDD's own files are taken from the
// docs as loaded rather than read again. Each issue remembers which SDD it points at and which
// SDD's file it sits in, so a check scoped to some SDDs can keep only those.
function refIssues(cfg, docs, files) {
  const nums = byNum(docs);
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
      if (text === null || !text.includes('SDD')) continue; // outside an SDD, every form carries SDD
      lines = D.splitLines(text).lines;
    }
    for (const ref of D.refsInFile(p, lines, { markdown: /\.mdx?$/i.test(p), inDoc: Boolean(own) })) {
      const bad = D.validateRef(ref, nums, own && own.doc);
      if (bad) issues.push({ path: p, line: ref.i + 1, ...bad, fixable: false, target: ref.num ?? own.doc.num, source: own ? own.doc.num : null });
    }
  }
  return issues;
}

function collectIssues(cfg, docs, sel, files) {
  const inSel = (num) => !sel || sel.has(D.docId(num));
  const issues = [];
  for (const d of docs) if (inSel(d.num)) issues.push(...docIssues(d, cfg));
  issues.push(...numberIssues(docs).filter((x) => inSel(x.num)));
  issues.push(...refIssues(cfg, docs, files).filter((x) => !sel || inSel(x.target) || (x.source !== null && inSel(x.source))));
  return issues;
}

function formatIssue(x) {
  return `${x.path}${x.line ? `:${x.line}` : ''}: ${x.level === 'warning' ? 'warning: ' : ''}${x.message}`;
}

function scriptPath() {
  return posix(path.resolve(__filename));
}

function report(issues) {
  const errors = issues.filter((x) => x.level === 'error');
  const warnings = issues.length - errors.length;
  for (const x of issues) console.log(formatIssue(x));
  if (!issues.length) {
    console.log('All SDD docs pass.');
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

function cmdCheck(cfg, args) {
  requireSddRoot(cfg);
  requireMaxLines(cfg);
  const docs = loadDocs(cfg);
  return report(collectIssues(cfg, docs, select(docs, args), citingFiles(cfg, docs)));
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
  requireSddRoot(cfg);
  requireMaxLines(cfg);
  const docs = loadDocs(cfg);
  const sel = select(docs, args);
  let blocked = false;
  for (const doc of docs) {
    if (doc.kind !== 'folder' || (sel && !sel.has(doc.id))) continue;
    const res = D.fixDoc(doc.files, { id: doc.id, maxLines: cfg.maxLines });
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
  console.log('');
  return report(collectIssues(cfg, after, sel, citingFiles(cfg, after)));
}

function cmdMigrate(cfg, dryRun) {
  requireSddRoot(cfg);
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
    if (text === null || !text.includes('SDD')) continue;
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
      const s = D.expandRefs(next);
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
    const res = D.fixDoc(input, { id: d.id, maxLines: cfg.maxLines });
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
  console.log('');
  const after = loadDocs(cfg);
  return report(collectIssues(cfg, after, null, citingFiles(cfg, after)));
}

// Docs keep names the code dropped, so a name found only in one proves nothing. Migrations keep
// the names they delete, so a name found only in one may be gone.
const DOC_FILE_RE = /\.(?:md|mdx|markdown|txt|rst|adoc)$/i;
const MIGRATION_RE = /(?:^|\/)(?:migrations|migrate)\//i;

// Whether a path the SDD names is one of the repository's files. A path from the repository root
// must be exact. A shorter one, like orders/orders.service.ts, may skip directories, so long as the
// file name matches and the directories it names come in order.
function pathFinder(files) {
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
  return {
    path: (p) => {
      const parts = p.split('/');
      const same = byBase.get(parts[parts.length - 1]) || [];
      return top.has(parts[0]) ? same.includes(p) : same.some((f) => inOrder(parts.slice(0, -1), f));
    },
    dir: (p) => files.some((f) => f.startsWith(`${p}/`) || f.includes(`/${p}/`)),
    // A directory may carry a file's name too: app/sitemap.xml/route.ts serves sitemap.xml.
    file: (p) => segments.has(p),
  };
}

// What lint says about the names in backticks the code no longer has: { ...name, why }. A path is
// looked up in the repository's file list, minus what git ignores, like build output. An
// identifier is looked up among the words of every text file but the SDDs and the docs, read once
// for all the names.
function missingNames(cfg, names) {
  const files = repoFiles(cfg.root);
  const has = pathFinder(files);
  const code = new Set();
  const migrations = new Set();
  if (names.some((n) => n.kind === 'name')) {
    const inSdd = (p) => p === cfg.sddRootRel || p.startsWith(`${cfg.sddRootRel}/`);
    for (const p of files) {
      if (inSdd(p) || DOC_FILE_RE.test(p)) continue;
      const text = readText(path.join(cfg.root, p));
      const into = MIGRATION_RE.test(p) ? migrations : code;
      if (text) for (const m of text.matchAll(/[A-Za-z_]\w*/g)) into.add(m[0]);
    }
  }
  const absent = [...new Set(names.filter((n) => n.kind !== 'name' && !has[n.kind](n.probe)).map((n) => n.probe))];
  const listed = absent.length ? git(cfg.root, ['check-ignore', '--stdin', '--no-index'], [0, 1], absent.join('\n')) : '';
  const ignored = new Set((listed || '').split(/\r?\n/).filter(Boolean));
  const out = [];
  for (const n of names) {
    if (n.kind !== 'name') {
      if (absent.includes(n.probe) && !ignored.has(n.probe)) out.push({ ...n, why: `no such ${n.kind === 'dir' ? 'directory' : 'file'} in the repository` });
    } else if (!code.has(n.probe)) {
      out.push({ ...n, why: migrations.has(n.probe) ? `${n.probe} is only in migrations: check whether one drops it` : `no ${n.probe} in the code` });
    }
  }
  return out;
}

// Leads for a content pass: what lintDoc finds, and the names in backticks the code no longer
// has. All warnings, since each needs a reading to confirm; the exit status is 0.
function cmdLint(cfg, args) {
  requireSddRoot(cfg);
  const docs = loadDocs(cfg);
  const sel = select(docs, args);
  const mine = docs.filter((d) => !sel || sel.has(d.id));
  const issues = [];
  for (const d of mine) {
    for (const x of D.lintDoc(d.model)) issues.push({ path: fileOf(d, x.file), line: x.i + 1, level: 'warning', message: x.message });
  }
  const names = mine.flatMap((d) => D.codeNames(d.model).map((n) => ({ ...n, path: fileOf(d, n.file) })));
  for (const n of missingNames(cfg, names)) {
    issues.push({ path: n.path, line: n.i + 1, level: 'warning', message: `\`${n.token}\`: ${n.why}` });
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

// The sections the given files cite, each with where it lives and who cites it. Files inside
// the SDD folders are skipped: this is for finding which docs a code change may have made wrong.
// A citation in a non-canonical spelling (SDD1§2) is listed under the id it means, with a note,
// since the doc it names is affected all the same.
function cmdRefs(cfg, args) {
  requireSddRoot(cfg);
  let files;
  if (args.length === 1 && args[0] === '--changed') {
    files = changedFiles(cfg.root);
    if (files === null) fail('--changed needs git');
  } else if (args.length) {
    files = args.map((a) => rel(cfg.root, path.resolve(a)));
  } else {
    fail('refs needs --changed or a list of files');
  }
  const docs = loadDocs(cfg);
  const nums = byNum(docs);
  const inSdd = (p) => cfg.sddRootRel && (p === cfg.sddRootRel || p.startsWith(`${cfg.sddRootRel}/`));
  const cited = new Map();
  for (const p of files) {
    if (inSdd(p)) continue;
    const text = readText(path.join(cfg.root, p));
    if (text === null || !text.includes('SDD')) continue;
    const { lines } = D.splitLines(text);
    for (const ref of D.refsInFile(p, lines, { markdown: /\.mdx?$/i.test(p), inDoc: false })) {
      const at = ref.anchor || ref.tag;
      const key = `${D.docId(ref.num)}${at ? `§${at}` : ''}`;
      if (!cited.has(key)) cited.set(key, { num: ref.num, anchor: ref.anchor, tag: ref.tag, by: [] });
      const note = ref.kind === 'noncanonical' ? ` (as ${ref.text}; write ${key})` : '';
      cited.get(key).by.push(`${p}:${ref.i + 1}${note}`);
    }
  }
  if (!cited.size) {
    console.log('No SDD references in those files.');
    return 0;
  }
  // By doc; within one, the doc itself, then its sections in order, then labels.
  const keys = [...cited.keys()].sort((a, b) => {
    const x = cited.get(a);
    const y = cited.get(b);
    return x.num - y.num || Boolean(x.tag) - Boolean(y.tag) || (x.tag ? a.localeCompare(b) : D.compareAnchors(x.anchor || '0', y.anchor || '0'));
  });
  for (const key of keys) {
    const { num, anchor, tag, by } = cited.get(key);
    const doc = (nums.get(num) || [])[0];
    const s = doc && anchor && doc.model.sections.get(anchor);
    const title = s ? s.title : doc && !anchor && !tag ? (doc.model.h1 ? doc.model.h1.text : '') : '';
    console.log(`${key}${title ? `  ${title}` : ''}`);
    if (!doc) console.log('  does not exist');
    else if (tag) console.log(`  ${D.validateRef({ kind: 'full', num, tag }, nums).message}`);
    else if (anchor && !s) console.log(`  not found in ${doc.rel}`);
    else console.log(`  in ${fileOf(doc, s ? s.file : D.README)}${s ? `:${s.i + 1}` : ''}`);
    console.log(`  cited by ${by.join(', ')}`);
  }
  return 0;
}

// One more than the highest number any SDD has had: on disk, or anywhere in git history on any
// branch, deleted ones included. A number is never reused, because something may still cite it.
function cmdNext(cfg) {
  requireSddRoot(cfg);
  let max = 0;
  for (const d of loadDocs(cfg)) max = Math.max(max, d.num);
  const log = git(cfg.root, ['log', '--all', '--format=', '--name-only', '--', cfg.sddRootRel]);
  if (log) {
    for (const line of log.split('\n')) {
      const m = /(?:^|\/)SDD(\d{3,})-[^/]*/.exec(line.trim());
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  console.log(D.docId(max + 1));
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

// The Stop hook. Silent unless an SDD folder changed since HEAD breaks a rule; then it prints a
// reply that sends the problems to the agent and keeps it working. It checks only the changed docs
// and the references inside them — references from code are the skill's job, not something to pay
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
  const starts = cursor ? [...(input.workspace_roots || []), process.cwd()] : [input.cwd || process.cwd()];
  const root = starts.map((dir) => findRoot(dir)).find(Boolean);
  if (!root) return 0;
  let cfg;
  try {
    cfg = loadConfig(root);
  } catch {
    return 0;
  }
  if (!cfg.sddRoot) return 0;
  const changed = changedFiles(root);
  if (!changed) return 0;
  const prefix = `${cfg.sddRootRel}/`;
  const touched = new Set();
  for (const p of changed) {
    if (!p.startsWith(prefix)) continue;
    const [first, ...restParts] = p.slice(prefix.length).split('/');
    if (restParts.length && D.DOC_DIR_RE.test(first)) touched.add(first);
  }
  if (!touched.size) return 0;

  const lines = [];
  if (!cfg.maxLines) {
    lines.push(`SDD docs changed, but ${CONFIG_NAME} has no valid sdd.maxLines, so they cannot be checked. Run the to-sdd skill's init to set it.`);
  } else {
    const docs = loadDocs(cfg);
    const mine = docs.filter((d) => d.kind === 'folder' && touched.has(d.name));
    const nums = new Set(mine.map((d) => d.num));
    const issues = [
      ...mine.flatMap((d) => docIssues(d, cfg)),
      ...numberIssues(docs).filter((x) => nums.has(x.num)),
      ...refIssues(cfg, docs, mine.flatMap((d) => [...d.files.keys()].map((name) => fileOf(d, name)))),
    ].filter((x) => x.level === 'error');
    if (!issues.length) return 0;
    const ids = [...new Set(mine.map((d) => d.id))];
    const fixable = issues.filter((x) => x.fixable);
    const manual = issues.filter((x) => !x.fixable);
    const runFix = [
      `  node "${scriptPath()}" fix ${ids.join(' ')}`,
      'It rewrites the files, so read again any you still need. It repairs:',
      ...fixable.map((x) => `  ${formatIssue(x)}`),
    ];
    const byHand = manual.map((x) => `  ${formatIssue(x)}`);
    lines.push('SDD docs changed in this task break the SDD rules. Repair them before you finish.');
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

// ---------------------------------------------------------------- main

const USAGE = 'usage: sdd-check.js <check|fix|migrate|lint|refs|next|hook> [SDDnnn ...] [--dry-run]';

function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  const dryRun = rest.includes('--dry-run');
  const args = rest.filter((a) => a !== '--dry-run');
  if (cmd === 'hook') {
    // Without input, readStdin would wait on the terminal forever.
    if (process.stdin.isTTY) {
      fail('hook reads the Stop hook input as JSON on stdin: the agent runs it; to try it by hand, pipe {"cwd":"<repository>"} into it');
    }
    process.exitCode = hook(readStdin());
    return;
  }
  if (!cmd || !['check', 'fix', 'migrate', 'lint', 'refs', 'next'].includes(cmd)) fail(USAGE);
  const root = findRoot(process.cwd());
  if (!root) fail(`no ${CONFIG_NAME} in this directory or above; the to-sdd skill's init creates it`);
  const cfg = loadConfig(root);
  if (cmd === 'check') process.exitCode = cmdCheck(cfg, args);
  else if (cmd === 'fix') process.exitCode = cmdFix(cfg, args, dryRun);
  else if (cmd === 'migrate') process.exitCode = cmdMigrate(cfg, dryRun);
  else if (cmd === 'lint') process.exitCode = cmdLint(cfg, args);
  else if (cmd === 'refs') process.exitCode = cmdRefs(cfg, args);
  else process.exitCode = cmdNext(cfg);
}

if (require.main === module) runMain(main);

module.exports = { findRoot, loadConfig, loadDocs, citingFiles, changedFiles, hook, main };
