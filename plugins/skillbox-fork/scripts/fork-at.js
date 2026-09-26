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
  claudeExe,
  needsShell,
  resumeCommand,
} = G;

// A slash-command turn is stored as a plain string, not a content array, so it
// escapes the content-block noise filter. Left alone, the wrapper tags end up
// in both the search corpus and the previews.
const COMMAND_RE =
  /^<command-message>[\s\S]*?<\/command-message>\s*<command-name>\/?([\w-]+(?::[\w-]+)*)<\/command-name>(?:\s*<command-args>([\s\S]*?)<\/command-args>)?/;

// Our own commands are machinery, never a place you would want to fork at, and
// every invocation adds a turn that shifts the numbering of everything else.
// Matched on the bare name: installed as a plugin these arrive namespaced, as
// /skillbox-fork:fork-at, and a set of bare names would stop matching.
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

  return {
    selIdx,
    total: sel.length,
    cutUuid,
    droppedTurns: sel.length - 1 - selIdx,
    // Assertable only when the discarded range is exactly the in-flight turn.
    // Anything else — dropped turns, or hidden fork-at turns in between — spans
    // more than one turn and the guard would refuse it.
    dropsTurnUuid: chosen.ai === all.length - 2 ? all[all.length - 1].uuid : null,
    label: preview(texts[chosen.ai].prompt, 56),
    id: chosen.uuid.slice(0, 8),
    where,
  };
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

// Offsets count from the end, so they shift as soon as the conversation grows —
// including from the very fork-at turns this command adds. The @id is stable,
// so it is offered first.
// Takes explicit {uuid, offset} pairs: the offset must be the real position in
// the selectable list, not an index into whatever subset is being displayed.
function pickHint(entries) {
  if (!entries.length) return [];
  const e = entries[Math.min(1, entries.length - 1)];
  return [
    '',
    `pick one:   /fork-at @${e.uuid.slice(0, 8)}       stable, always this turn`,
    `            /fork-at ${String(e.offset).padEnd(14)}counts back from the end, shifts if the conversation grows`,
  ];
}

function failAmbiguous(needle, hits, sel, texts) {
  const lines = [`"${needle}" matches ${hits.length} turns — pick one.`, ''];
  for (const h of [...hits].reverse()) {
    const n = sel.length - 1 - h.i;
    const t = texts[h.e.ai];
    const body = h.inPrompt ? snippet(t.prompt, t.pN, needle, 58) : snippet(t.answer, t.aN, needle, 58);
    lines.push(`  ${String(n).padStart(2)}  @${h.e.uuid.slice(0, 8)}  ${h.where.padEnd(11)} ${body}`);
  }
  lines.push(...pickHint(hits.map((h) => ({ uuid: h.e.uuid, offset: sel.length - 1 - h.i })).reverse()));
  fail(lines.join('\n'));
}

function failNoMatch(needle, sel, texts) {
  const lines = [
    `nothing matches "${needle}" — searched your prompts and the answers.`,
    '',
    'turns you can select (newest first):',
  ];
  const shown = sel.slice(-12).reverse();
  shown.forEach((e, i) => {
    lines.push(`  ${String(i).padStart(2)}  @${e.uuid.slice(0, 8)}  "${preview(texts[e.ai].prompt, 62)}"`);
    const ans = texts[e.ai].answer;
    if (ans) lines.push(`                   ${preview(ans, 62)}`);
  });
  lines.push(...pickHint(shown.map((e, i) => ({ uuid: e.uuid, offset: i }))));
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

// -p needs a prompt, so a fork with no directive still costs one turn. That
// turn must not start work: the fork usually exists because the plan is still
// being argued about, and in auto mode an instruction like "continue" is
// enough for the child to begin editing files on its own.
// Phrased as "nothing asked yet", never as a prohibition. Wording like "do
// not use any tools" reads as a standing rule for the whole session, so the
// child would carry it forward and refuse to work later.
const IDLE = ['Session forked from the conversation above, at the point shown.', "Wait for next user's input."].join(
  '\n',
);

function childPrompt(parent, cutUuid, directive) {
  return `[fork] parent=${parent} cut=${cutUuid}\n\n${directive || IDLE}`;
}

// The headless call that creates the child.
//
// The prompt is multi-line and carries whatever the directive says, so it
// cannot survive a shell: Node joins the arguments with spaces and quotes
// nothing, and cmd.exe cannot carry a newline in an argument at all. When a
// shell is unavoidable, the prompt goes on stdin — `claude -p` reads it from
// there when no prompt argument is given — and every argument left is a flag
// or an id, which no shell can mangle. They are joined into one command string
// here, because Node deprecates passing an argument list alongside a shell.
function buildInvocation({ exe, parent, child, cut, prompt, platform = process.platform }) {
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
    `fork-${parent.slice(0, 8)}`,
  ];
  if (shell) {
    const quoted = /\s/.test(exe) ? `"${exe}"` : exe;
    return { command: [quoted, ...args].join(' '), args: [], input: prompt, shell };
  }
  return { command: exe, args: [...args, prompt], input: null, shell };
}

// ---------------------------------------------------------------- main

function main() {
  const { flags, selector, directive } = parseArgs(process.argv.slice(2));

  const root = configRoot();
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

  const prompt = childPrompt(parent, cut.cutUuid, directive);
  say('directive', directive ? `"${preview(directive, 56)}"` : 'none — child opens idle and waits for you');

  const inv = buildInvocation({ exe: claudeExe(), parent, child, cut, prompt });

  if (flags.has('--dry-run')) {
    // The prompt is shown separately: it contains newlines, and rendering it
    // inline would produce a command that looks copy-pasteable but would send
    // a literal backslash-n.
    const shown = (inv.input === null ? inv.args.slice(0, -1) : inv.args).map((a) => (/\s/.test(a) ? `"${a}"` : a));
    console.log('');
    console.log('would run');
    const stdin = inv.input === null ? '<prompt>' : '< prompt on stdin';
    console.log(`  ${[inv.command, ...shown, stdin].join(' ')}`);
    console.log('');
    console.log('prompt');
    for (const line of prompt.split('\n')) console.log(`  ${line}`);
    return;
  }

  console.log('');
  console.log('creating fork…  (one headless turn over the kept history)');
  const started = Date.now();
  const opts = {
    encoding: 'utf8',
    input: inv.input === null ? undefined : inv.input,
    stdio: [inv.input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    env: cleanEnv(),
  };
  const res = inv.shell ? spawnSync(inv.command, { ...opts, shell: true }) : spawnSync(inv.command, inv.args, opts);

  if (res.error) fail(`could not run ${inv.command}: ${res.error.message}`);
  if (res.status !== 0) {
    console.error((res.stderr || res.stdout || '').trim());
    fail(`claude exited ${res.status} — no fork created, nothing recorded`);
  }
  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log('');

  const ledger = path.join(root, 'fork-tree.jsonl');
  const entry = {
    ts: new Date().toISOString(),
    parent,
    child,
    cutUuid: cut.cutUuid,
    droppedTurns: cut.droppedTurns,
    matchedPrompt: cut.label,
    cwd: process.cwd(),
    // null records "no directive given", rather than storing the boilerplate.
    directive: directive || null,
  };
  try {
    fs.appendFileSync(ledger, `${JSON.stringify(entry)}\n`, 'utf8');
    say('ledger', ledger);
  } catch (e) {
    note(`could not write the ledger (${e.message}) — the [fork] marker in the child still records the link`);
  }

  // Two audiences, two strings. The printed one is for you to type later in
  // your own shell, where PATH is what resolves; the spawned one names the
  // resolved binary, because the new window inherits no PATH assumption.
  say('resume', `claude --resume ${child}`);

  if (flags.has('--no-open')) return;
  const opened = openTerminal(resumeCommand(child));
  say('opened', opened || 'nothing — no terminal found; run the resume command above');
}

if (require.main === module) runMain(main);

module.exports = {
  commandOf,
  displayText,
  normalize,
  turnTexts,
  resolveCut,
  snippet,
  parseSelector,
  parseArgs,
  childPrompt,
  buildInvocation,
};
