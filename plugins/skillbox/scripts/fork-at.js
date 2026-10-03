#!/usr/bin/env node
// Forks the current Claude Code conversation into a new session, truncated at a chosen point.
// Usage: node <plugin>/scripts/fork-at.js <@id | N | search text> [-- <directive for the child>]
//        Use fork-tree.js to view the resulting tree.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const G = require('./lib/fork-graph');
const {
  CliError,
  runMain,
  configRoot,
  findTranscript,
  readRows,
  isHumanPrompt,
  promptText,
  preview,
  openTerminal,
  cleanEnv,
  needsShell,
  quoteIfSpaced,
} = G;

// A slash-command turn is stored as a plain string, not a content array, so it
// escapes the content-block noise filter. Left alone, the wrapper tags end up
// in both the search corpus and the previews.
const COMMAND_RE =
  /^<command-message>[\s\S]*?<\/command-message>\s*<command-name>\/?([\w-]+(?::[\w-]+)*)<\/command-name>(?:\s*<command-args>([\s\S]*?)<\/command-args>)?/;

// Our own commands are machinery, never a place you would want to fork at, and
// every invocation adds a turn that shifts the numbering of everything else.
// Matched on the bare name: installed as a plugin these arrive namespaced, as
// /skillbox:fork-at, and a set of bare names would stop matching.
const OUR_COMMANDS = new Set(['fork-at', 'fork-tree']);

// ---------------------------------------------------------------- cut point

function commandOf(d) {
  const c = d.message && d.message.content;
  if (typeof c !== 'string') return null;
  const m = COMMAND_RE.exec(c.trim());
  // name keeps whatever was typed, namespace included, so a preview reads back
  // as the user wrote it. bare is the identity the OUR_COMMANDS filter tests.
  return m ? { name: m[1], bare: m[1].split(':').pop(), args: (m[2] || '').trim() } : null;
}

// What the turn looks like to you, with command scaffolding reduced to the
// command you actually typed.
function displayText(d) {
  const cmd = commandOf(d);
  if (cmd) return `/${cmd.name}${cmd.args ? ` ${cmd.args}` : ''}`;
  return promptText(d);
}

// You read rendered text; the transcript stores markdown source. Searching the
// source verbatim fails on any phrase containing inline formatting — `B3`'s
// reads as B3's on screen but not in the file. Same for curly quotes, long
// dashes and line wrapping inside a phrase. So both sides are normalised, and
// the map records where each normalised character came from so a snippet can
// still be cut from the original text.
const DROP_CHARS = /[`*_~[\]]/;
const FOLD = { '’': "'", '‘': "'", '“': '"', '”': '"', '—': '-', '–': '-' };

function normalize(raw) {
  const out = [];
  const map = [];
  let prevSpace = false;
  for (let i = 0; i < raw.length; i++) {
    let ch = raw[i];
    if (DROP_CHARS.test(ch)) continue;
    if (FOLD[ch]) ch = FOLD[ch];
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      ch = ' ';
      prevSpace = true;
    } else {
      prevSpace = false;
    }
    out.push(ch.toLowerCase());
    map.push(i);
  }
  return { text: out.join(''), map };
}

// Searchable text per turn: what you typed, and what the assistant answered.
// Thinking blocks, tool inputs and tool results are deliberately excluded —
// matching those would hit file contents and command output and land you on a
// turn you never saw.
function turnTexts(rows, all) {
  const idxByUuid = new Map(all.map((d, i) => [d.uuid, i]));
  const texts = all.map(() => ({ prompt: '', answer: '' }));
  let cur = -1;
  for (const d of rows) {
    if (d.uuid !== undefined && idxByUuid.has(d.uuid) && isHumanPrompt(d)) {
      cur = idxByUuid.get(d.uuid);
      texts[cur].prompt = displayText(d);
      continue;
    }
    if (cur < 0 || d.type !== 'assistant' || d.isSidechain === true) continue;
    const t = promptText(d);
    if (t) texts[cur].answer += (texts[cur].answer ? '\n' : '') + t;
  }
  for (const t of texts) {
    t.pN = normalize(t.prompt);
    t.aN = normalize(t.answer);
  }
  return texts;
}

// A match anywhere in a turn — your prompt or the answer — cuts at the END of
// that turn. Keeping cuts on turn boundaries is what stops a fork from
// splitting a tool call and orphaning a tool_use block.
function resolveCut(rows, selector) {
  const all = rows.filter(isHumanPrompt);
  if (all.length < 2) {
    fail('nothing to fork — this conversation has no completed turns yet');
  }
  const texts = turnTexts(rows, all);

  // Selectable turns keep their index into `all`, because the cut uuid always
  // comes from the *next* prompt in the full list — which may be a fork-at turn
  // we are hiding, and cutting just before it is exactly what we want.
  const sel = [];
  all.forEach((d, ai) => {
    if (ai === all.length - 1) return; // the invocation running right now
    const cmd = commandOf(d);
    if (cmd && OUR_COMMANDS.has(cmd.bare)) return;
    sel.push({ ai, uuid: d.uuid, row: d });
  });
  if (!sel.length) {
    fail('no conversation turns to fork at — this session contains only fork commands');
  }

  let selIdx;
  let where = null;

  if (selector === null) {
    selIdx = sel.length - 1;
  } else if (selector.kind === 'id') {
    const hits = sel.filter((e) => e.uuid.startsWith(selector.value));
    if (!hits.length) fail(`no turn with id starting "${selector.value}"`);
    if (hits.length > 1) fail(`"${selector.value}" matches ${hits.length} turns — use more characters`);
    selIdx = sel.indexOf(hits[0]);
  } else if (selector.kind === 'offset') {
    selIdx = sel.length - 1 - selector.value;
    if (selIdx < 0) {
      fail(`cannot drop ${selector.value} turn(s) — only ${sel.length} selectable turn(s) exist`);
    }
  } else {
    const needle = normalize(selector.value).text.trim();
    if (!needle) fail('empty search text');
    const hits = [];
    sel.forEach((e, i) => {
      const inPrompt = texts[e.ai].pN.text.includes(needle);
      const inAnswer = texts[e.ai].aN.text.includes(needle);
      if (!inPrompt && !inAnswer) return;
      hits.push({ i, e, inPrompt, where: inPrompt && inAnswer ? 'both' : inPrompt ? 'your prompt' : 'the answer' });
    });
    if (hits.length === 0) failNoMatch(selector.value, sel, texts);
    // No priority between your words and the answers: both rules are guesses
    // and both overshoot. Preferring the newest walks forward past the turn you
    // meant whenever an answer echoed you; preferring your prompts walks all
    // the way back to turn 1 whenever an early message used the phrase. So
    // resolve automatically only when the match is unambiguous.
    if (hits.length > 1) failAmbiguous(needle, hits, sel, texts);
    selIdx = hits[0].i;
    where = hits[0].where === 'both' ? 'your prompt and the answer' : hits[0].where;
  }

  const chosen = sel[selIdx];
  const next = all[chosen.ai + 1];
  const cutUuid = next && next.parentUuid;
  if (!cutUuid) {
    fail('the matched turn is the first in the session — there is nothing to keep before it');
  }

  const label = preview(texts[chosen.ai].prompt, 56);
  return {
    selIdx,
    total: sel.length,
    cutUuid,
    droppedTurns: sel.length - 1 - selIdx,
    // Assertable only when the discarded range is exactly the in-flight turn.
    // Anything else — dropped turns, or hidden fork-at turns in between — spans
    // more than one turn and the guard would refuse it.
    dropsTurnUuid: chosen.ai === all.length - 2 ? all[all.length - 1].uuid : null,
    label,
    name: forkName(selector, label),
    id: chosen.uuid.slice(0, 8),
    where,
  };
}

// The child's session name, as the `claude --resume` picker and the fork tree
// show it. Your search text when you gave one — it is the phrase you already
// think of the fork by — else the matched turn's prompt, since an @id or a
// count says nothing on its own. One line: a name cannot carry a newline.
const NAME_WIDTH = 56;

function forkName(selector, label) {
  const text = preview(selector && selector.kind === 'text' ? selector.value : label, NAME_WIDTH);
  return text ? `Fork: ${text}` : 'Fork';
}

// ---------------------------------------------------------------- output

function say(label, value) {
  console.log(`${label.padEnd(10)}${value}`);
}
function note(msg) {
  console.log(`${'note'.padEnd(10)}${msg}`);
}
function fail(msg) {
  throw new CliError(msg);
}

// A window centred on the match, so an answer hit shows the words around it
// rather than the opening line of a long reply.
function snippet(raw, norm, needle, width) {
  const at = norm.text.indexOf(needle);
  if (at < 0) return preview(raw, width);
  const rawAt = norm.map[at];
  const start = Math.max(0, rawAt - Math.floor((width - needle.length) / 2));
  const body = String(raw)
    .slice(start, start + width)
    .replace(/\s+/g, ' ');
  return `${start > 0 ? '…' : ''}${body}${start + width < raw.length ? '…' : ''}`;
}

// The command is printed in full: a plugin's commands only answer to their
// namespaced name, so a bare /fork-at is an unknown command.
const COMMAND = '/skillbox:fork-at';

// Only the @id is offered. An offset counts back from the end, so it shifts as
// the conversation grows, and it reads in the opposite direction to the list.
function pickHint(uuid) {
  return ['', `pick one:   ${COMMAND} @${uuid.slice(0, 8)}   stable, always this turn`];
}

// Candidate lists run oldest to newest, in the order of the conversation, and
// name each turn by its place in it: "turn 2 of 5" is the same number the
// fork's own output uses. Listed newest first, two identical prompts traded
// places — "the first one" meant the earlier turn to you and the later one to
// the list, and a picker built from it forked at the wrong one.
// Each candidate also shows the other half of its exchange. Two turns that
// match the same words rarely got the same answer, and that is what tells them
// apart.
function turnPos(i, sel) {
  return `turn ${i + 1} of ${sel.length}`.padEnd(`turn ${sel.length} of ${sel.length}`.length);
}

function failAmbiguous(needle, hits, sel, texts) {
  const lines = [`"${needle}" matches ${hits.length} turns — pick one.`, ''];
  for (const h of hits) {
    const t = texts[h.e.ai];
    const lead = `  ${turnPos(h.i, sel)}  @${h.e.uuid.slice(0, 8)}  `;
    const body = h.inPrompt ? snippet(t.prompt, t.pN, needle, 58) : snippet(t.answer, t.aN, needle, 58);
    lines.push(`${lead}${h.where.padEnd(11)} ${body}`);
    const other = h.inPrompt ? t.answer && `answer: ${preview(t.answer, 58)}` : `you: ${preview(t.prompt, 58)}`;
    if (other) lines.push(`${' '.repeat(lead.length)}${other}`);
  }
  lines.push(...pickHint(hits[hits.length - 1].e.uuid));
  fail(lines.join('\n'));
}

function failNoMatch(needle, sel, texts) {
  const from = Math.max(0, sel.length - 12);
  const lines = [
    `nothing matches "${needle}" — searched your prompts and the answers.`,
    '',
    from ? `your latest ${sel.length - from} turns, oldest first:` : 'turns you can select, oldest first:',
  ];
  sel.slice(from).forEach((e, k) => {
    const t = texts[e.ai];
    const lead = `  ${turnPos(from + k, sel)}  @${e.uuid.slice(0, 8)}  `;
    lines.push(`${lead}"${preview(t.prompt, 62)}"`);
    if (t.answer) lines.push(`${' '.repeat(lead.length)}answer: ${preview(t.answer, 62)}`);
  });
  lines.push(...pickHint(sel[sel.length - 1].uuid));
  fail(lines.join('\n'));
}

// ---------------------------------------------------------------- invocation

function parseSelector(raw) {
  if (raw === '') return null;
  if (raw.startsWith('@')) return { kind: 'id', value: raw.slice(1).toLowerCase() };
  if (/^\d+$/.test(raw)) return { kind: 'offset', value: parseInt(raw, 10) };
  return { kind: 'text', value: raw };
}

// Everything before the first standalone `--` is the selector, everything
// after is the directive. Flags are recognised only on the selector side, so a
// directive may say "--dry-run" and mean it as text.
//
// The arguments are joined and re-split rather than read one by one. The
// slash command passes them as a single quoted string — search text is full of
// apostrophes, which unquoted would break the shell — and in that string `--`
// is no longer an argument of its own. Joining first makes one quoted string
// and separately passed words parse the same.
function parseArgs(argv) {
  const raw = argv.join(' ');
  const sep = /(^|\s)--(\s|$)/.exec(raw);
  const head = sep ? raw.slice(0, sep.index) : raw;
  const directive = sep ? raw.slice(sep.index + sep[0].length).trim() || null : null;

  const flags = new Set();
  const words = [];
  for (const w of head.split(/\s+/).filter(Boolean)) {
    if (w === '--dry-run' || w === '--no-open') flags.add(w);
    else words.push(w);
  }
  return { flags, selector: parseSelector(words.join(' ')), directive };
}

// The child's first turn, spent by -p on creating the fork. It must not start
// work: the fork usually exists because the plan is still being argued about,
// and in auto mode an instruction like "continue" is enough for the child to
// begin editing files on its own, with nobody watching.
// Phrased as "nothing asked yet", never as a prohibition. Wording like "do
// not use any tools" reads as a standing rule for the whole session, so the
// child would carry it forward and refuse to work later.
// A directive is never part of it. It is sent afterwards, as your first
// message in the interactive session, where you can see it run and approve
// what it does.
const IDLE = ['Session forked from the conversation above, at the point shown.', "Wait for next user's input."].join(
  '\n',
);

function childPrompt(parent, cutUuid) {
  return `[fork] parent=${parent} cut=${cutUuid}\n\n${IDLE}`;
}

// The headless call that creates the child.
//
// The prompt is multi-line, so it cannot survive a shell: Node joins the
// arguments with spaces and quotes nothing, and cmd.exe cannot carry a newline
// in an argument at all. When a shell is unavoidable, the prompt goes on stdin
// — `claude -p` reads it from there when no prompt argument is given — and
// every argument left is a flag or an id, which no shell can mangle, except
// the name, which is your own words and travels the way a directive does.
// They are joined into one command string here, because Node deprecates
// passing an argument list alongside a shell.
function buildInvocation({ exe, parent, child, cut, prompt, name, platform = process.platform }) {
  const shell = needsShell(exe, platform);
  const args = [
    '-p',
    '--resume',
    parent,
    '--fork-session',
    '--session-id',
    child,
    '--resume-session-at',
    cut.cutUuid,
    ...(cut.dropsTurnUuid ? ['--resume-drops-turn', cut.dropsTurnUuid] : []),
    '--name',
  ];
  if (shell) {
    return { command: [quoteIfSpaced(exe), ...args, cmdWord(name)].join(' '), args: [], input: prompt, shell };
  }
  return { command: exe, args: [...args, name, prompt], input: null, shell };
}

// One argument through cmd.exe, as exact as cmd allows. A `"` inside toggles
// cmd's quoting and exposes `&` and `|` to it, so double quotes become single
// ones and whitespace is flattened. Only the bare `claude` on Windows goes
// this way, rare in practice; everywhere else arguments are passed untouched.
function cmdWord(s) {
  return `"${String(s).replace(/"/g, "'").replace(/\s+/g, ' ')}"`;
}

// The interactive session the window ends in, with the directive as its first
// message. Stdin is the terminal here, so a directive can only travel as an
// argument — through cmd.exe, as exact as cmdWord can make it.
function buildResume({ exe, child, directive, platform = process.platform }) {
  const shell = needsShell(exe, platform);
  if (shell) {
    const words = [quoteIfSpaced(exe), '--resume', child];
    if (directive) words.push(cmdWord(directive));
    return { command: words.join(' '), args: [], shell };
  }
  return { command: exe, args: ['--resume', child, ...(directive ? [directive] : [])], shell };
}

// ---------------------------------------------------------------- hand-off

// The parent's half ends by writing everything the window needs into one file,
// because the window cannot be trusted to inherit anything else. Terminal.app,
// iTerm and gnome-terminal start from a fresh environment and your home
// directory, so a CLAUDE_CONFIG_DIR, the resolved binary and the project
// directory would all be lost. The directive travels here too, which keeps it
// off a command line that four different shells would each quote differently.
function pendingFile(root, child) {
  return path.join(G.pendingDir(root), `${child}.json`);
}

function buildSpec({ root, rows, parent, child, cut, directive, env = process.env, fallbackCwd = process.cwd() }) {
  return {
    version: 1,
    root,
    configDir: env.CLAUDE_CONFIG_DIR || null,
    exe: env.CLAUDE_CODE_EXECPATH || 'claude',
    cwd: G.sessionCwd(rows) || fallbackCwd,
    parent,
    child,
    cutUuid: cut.cutUuid,
    dropsTurnUuid: cut.dropsTurnUuid,
    droppedTurns: cut.droppedTurns,
    label: cut.label,
    name: cut.name,
    directive: directive || null,
  };
}

function writeSpec(spec) {
  const file = pendingFile(spec.root, spec.child);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(spec, null, 2), 'utf8');
  return file;
}

function readSpec(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail(`cannot read the fork hand-off ${file}: ${e.message}`);
  }
  // One use only: a hand-off replayed later would create a second child.
  // Removed before it is judged, so one this script cannot use does not
  // linger either.
  try { fs.unlinkSync(file); } catch { /* already gone is fine */ }
  let spec;
  try {
    spec = JSON.parse(text);
  } catch (e) {
    fail(`cannot read the fork hand-off ${file}: ${e.message}`);
  }
  if (!spec || spec.version !== 1) fail(`unrecognised fork hand-off ${file}`);
  return spec;
}

// What the window runs: this script again, in its finishing mode. Absolute
// node and script paths, because the window's PATH is not ours.
function finishCommand(specFile, node = process.execPath, script = __filename) {
  return [quoteIfSpaced(node), quoteIfSpaced(script), '--finish', quoteIfSpaced(specFile)].join(' ');
}

// The environment for everything the window launches: never nested inside the
// parent, and pointed at the parent's config directory.
function childEnv(spec, base = cleanEnv()) {
  const env = { ...base };
  if (spec.configDir) env.CLAUDE_CONFIG_DIR = spec.configDir;
  return env;
}

// The session's directory has to exist before anything is launched: claude
// --resume looks the parent up from there, and from anywhere else the window
// would open only to show "no conversation found". Checked in the parent, so
// no window opens for nothing, and again in the window, whose hand-off may
// outlive the directory.
function requireCwd(cwd, transcriptFile) {
  if (!fs.existsSync(cwd)) fail(G.missingCwdMessage(cwd, transcriptFile));
}

// ---------------------------------------------------------------- the fork

// -p tags every row it writes "entrypoint":"sdk-cli", the history copied from
// the parent included, and Claude Code takes a session tagged that way for a
// headless SDK run: it leaves it out of the /resume picker and never resolves
// its name, so the child would answer only to its full id. No flag or
// variable changes the tag, and only -p honours the cut, so the tag is fixed
// afterwards — to "cli", what an interactive fork writes. Nothing else writes
// the file between the -p call exiting and the window resuming it.
// Only the row's own field changes. The same words inside a message are
// escaped JSON and never match, and a line that does not parse is kept as is.
function retagInteractive(file) {
  let changed = 0;
  const lines = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => {
      if (!line.includes('"sdk-cli"')) return line;
      let row;
      try { row = JSON.parse(line); } catch { return line; }
      if (!row || row.entrypoint !== 'sdk-cli') return line;
      changed++;
      return JSON.stringify({ ...row, entrypoint: 'cli' });
    });
  if (!changed) return 0;
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, lines.join('\n'), 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* never written */ }
    throw e;
  }
  return changed;
}

// Runs the headless turn that creates the child, then records it. Throws, with
// nothing recorded, when the child could not be created.
// The progress lines are for the window, where you watch it happen. Run from
// the parent they would only add to its history, so they are left out there.
function createFork(spec, { quiet = false } = {}) {
  const prompt = childPrompt(spec.parent, spec.cutUuid);
  const cut = { cutUuid: spec.cutUuid, dropsTurnUuid: spec.dropsTurnUuid };
  const inv = buildInvocation({ exe: spec.exe, parent: spec.parent, child: spec.child, cut, prompt, name: spec.name });

  if (!quiet) console.log('creating fork…  (one headless turn over the kept history)');
  const started = Date.now();
  const opts = {
    encoding: 'utf8',
    input: inv.input === null ? undefined : inv.input,
    stdio: [inv.input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    cwd: spec.cwd,
    env: childEnv(spec),
  };
  const res = inv.shell ? spawnSync(inv.command, { ...opts, shell: true }) : spawnSync(inv.command, inv.args, opts);

  if (res.error) fail(`could not run ${inv.command}: ${res.error.message}`);
  if (res.status !== 0) {
    console.error((res.stderr || res.stdout || '').trim());
    fail(`claude exited ${res.status} — no fork created, nothing recorded`);
  }
  if (!quiet) console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);

  // A fork left tagged still works, so a failure here is only reported.
  try {
    const file = findTranscript(spec.root, spec.child);
    if (!file) throw new Error('no transcript found');
    retagInteractive(file);
  } catch (e) {
    note(`the fork is hidden from /resume's picker and name lookup (${e.message}) — resume it by its full id`);
  }

  const ledger = path.join(spec.root, 'fork-tree.jsonl');
  const entry = {
    ts: new Date().toISOString(),
    parent: spec.parent,
    child: spec.child,
    cutUuid: spec.cutUuid,
    droppedTurns: spec.droppedTurns,
    matchedPrompt: spec.label,
    cwd: spec.cwd,
    // null records "no directive given", rather than storing the boilerplate.
    directive: spec.directive,
  };
  try {
    fs.appendFileSync(ledger, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (e) {
    note(`could not write the ledger (${e.message}) — the [fork] marker in the child still records the link`);
  }
}

// The window's half: create the fork, then become the child session.
function finish(specFile) {
  const spec = readSpec(specFile);
  requireCwd(spec.cwd, findTranscript(spec.root, spec.parent));
  createFork(spec);
  console.log('');
  const inv = buildResume({ exe: spec.exe, child: spec.child, directive: spec.directive });
  const opts = { stdio: 'inherit', cwd: spec.cwd, env: childEnv(spec) };
  const res = inv.shell ? spawnSync(inv.command, { ...opts, shell: true }) : spawnSync(inv.command, inv.args, opts);
  if (res.error) fail(`could not run ${inv.command}: ${res.error.message}`);
  process.exit(res.status === null ? 1 : res.status);
}

// ---------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--finish') return finish(argv.slice(1).join(' '));

  const { flags, selector, directive } = parseArgs(argv);

  const root = configRoot();
  G.sweepPending(root);
  const parent = process.env.CLAUDE_CODE_SESSION_ID;
  if (!parent) {
    fail('CLAUDE_CODE_SESSION_ID is not set — run this from inside a Claude Code session');
  }
  const transcript = findTranscript(root, parent);
  if (!transcript) {
    fail(`no transcript for session ${parent} under ${path.join(root, 'projects')}`);
  }

  const rows = readRows(transcript);
  const cut = resolveCut(rows, selector);
  const child = crypto.randomUUID();
  const spec = buildSpec({ root, rows, parent, child, cut, directive });

  if (flags.has('--dry-run')) return dryRun({ parent, child, cut, spec, selector, directive });
  requireCwd(spec.cwd, transcript);

  // Two audiences, two strings. The printed one is for you to type later in
  // your own shell, where PATH is what resolves; the window gets the resolved
  // binary, because it inherits no PATH assumption.
  const resumeHint = `claude --resume ${child}`;

  // --no-open, or no terminal to open: create the fork here and leave the
  // child for you to resume. The directive has nowhere to go without a window.
  const createHere = () => {
    createFork(spec, { quiet: true });
    const unsent = directive ? ' (directive not sent — paste it in yourself)' : '';
    console.log(summaryLine(cut, child, `resume with: ${resumeHint}${unsent}`));
  };

  if (flags.has('--no-open')) return createHere();

  // The window does the slow part, so it opens now rather than after a model
  // turn, and nothing here waits on it.
  const specFile = writeSpec(spec);
  const opened = openTerminal(finishCommand(specFile), spec.cwd);
  if (!opened) {
    fs.unlinkSync(specFile);
    note('no terminal found — creating the fork here instead');
    return createHere();
  }
  console.log(summaryLine(cut, child, `opening in ${opened}`));
}

// What a real run prints: one line. It stays in the parent's history for good,
// once per fork, so it carries only what you would act on — which turn, which
// child, where it went. The full plan is --dry-run's job.
function summaryLine(cut, child, where) {
  return `forked after "${cut.label}" (turn ${cut.selIdx + 1} of ${cut.total}) → ${child.slice(0, 8)}, ${where}`;
}

function dryRun({ parent, child, cut, spec, selector, directive }) {
  say('parent', parent);
  if (selector === null) {
    say('matched', `whole conversation — all ${cut.total} turn(s)`);
  } else {
    const src = cut.where ? ` (matched in ${cut.where})` : '';
    say('matched', `turn ${cut.selIdx + 1} of ${cut.total}  @${cut.id}${src}   "${cut.label}"`);
  }
  say(
    'keeping',
    cut.droppedTurns === 0
      ? 'through the last completed exchange'
      : `through that exchange — dropping the last ${cut.droppedTurns} turn(s)`,
  );
  say('cut', cut.cutUuid);
  say('child', child);
  say('name', spec.name);
  say(
    'directive',
    directive
      ? `"${preview(directive, 56)}" — sent as your first message in the child`
      : 'none — child opens idle and waits for you',
  );
  // A dry run reports the missing directory where a real run would refuse on
  // it, and still shows the rest of the plan.
  say('cwd', fs.existsSync(spec.cwd) ? spec.cwd : `${spec.cwd}   (missing — a real run stops here)`);

  // The prompt is shown separately: it contains newlines, and rendering it
  // inline would produce a command that looks copy-pasteable but would send a
  // literal backslash-n.
  const prompt = childPrompt(parent, cut.cutUuid);
  const inv = buildInvocation({ exe: spec.exe, parent, child, cut, prompt, name: spec.name });
  const shown = (inv.input === null ? inv.args.slice(0, -1) : inv.args).map(quoteIfSpaced);
  const stdin = inv.input === null ? '<prompt>' : '< prompt on stdin';
  const resume = buildResume({ exe: spec.exe, child, directive: spec.directive });
  console.log('');
  console.log('would open a window that runs');
  console.log(`  ${[inv.command, ...shown, stdin].join(' ')}`);
  console.log(`  ${[resume.command, ...resume.args.map(quoteIfSpaced)].join(' ')}`);
  console.log('');
  console.log('prompt');
  for (const line of prompt.split('\n')) console.log(`  ${line}`);
}

if (require.main === module) runMain(main);

module.exports = {
  commandOf,
  displayText,
  normalize,
  turnTexts,
  resolveCut,
  forkName,
  snippet,
  parseSelector,
  parseArgs,
  childPrompt,
  summaryLine,
  buildInvocation,
  buildResume,
  buildSpec,
  retagInteractive,
  pendingFile,
  finishCommand,
  childEnv,
};
