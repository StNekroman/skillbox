// Shared session-transcript helpers for fork-at.js and fork-tree.js.
// Reads Claude Code's own transcript store; never writes to it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');

const NOISE_TAGS = /^<(ide_opened_file|ide_selection|system-reminder|command-name|command-message|command-args|local-command-stdout)\b/;
const MARKER = /\[fork\]\s+parent=([0-9a-f-]{36})\s+cut=([0-9a-f-]{36})/;
const CACHE_VERSION = 3;

// ---------------------------------------------------------------- errors

// A failure meant for the person running the script. Thrown rather than exiting
// on the spot, so the logic can be exercised from tests; runMain turns it into
// the printed error and exit code 1. Anything else propagates as a crash.
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

// ---------------------------------------------------------------- transcript

function configRoot() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Session transcripts are exactly the depth-1 *.jsonl files. The subagents/ and
// tool-results/ subdirectories are per-session sidecars, not sessions.
function listTranscripts(root) {
  const projects = path.join(root, 'projects');
  const out = [];
  if (!fs.existsSync(projects)) return out;
  for (const dir of fs.readdirSync(projects)) {
    const dirPath = path.join(projects, dir);
    let files;
    try { files = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { continue; }
    for (const ent of files) {
      if (!ent.isFile() || !ent.name.endsWith('.jsonl')) continue;
      out.push({ sessionId: ent.name.slice(0, -6), file: path.join(dirPath, ent.name), project: dir });
    }
  }
  return out;
}

function findTranscript(root, sessionId) {
  const hit = listTranscripts(root).find((t) => t.sessionId === sessionId);
  return hit ? hit.file : null;
}

function readRows(file) {
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip partial/corrupt line */ }
  }
  return rows;
}

// A real typed prompt. Tool results are also type:"user" but carry no origin,
// and neither do synthetic rows like "[Request interrupted by user...]" or any
// prompt delivered by -p.
function isHumanPrompt(d) {
  return d.type === 'user' && d.isSidechain !== true && d.origin && d.origin.kind === 'human';
}

function promptText(d) {
  const c = d.message && d.message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c
    .filter((b) => b.type === 'text' && !NOISE_TAGS.test(b.text || ''))
    .map((b) => b.text)
    .join('\n');
}

// The directory the session was started in. Claude Code files a session under
// its project directory, and `--resume` looks it up from the directory it runs
// in, so anything that resumes a session has to run from here — not from
// wherever the calling shell happens to be.
function sessionCwd(rows) {
  const hit = rows.find((d) => typeof d.cwd === 'string' && d.cwd);
  return hit ? hit.cwd : null;
}

// The error for a session directory that is gone. With it gone there is
// nowhere to resume from — see sessionCwd — and the store is Claude Code's,
// so the transcript is never moved from here; the remedies are spelled out
// instead. The transcript's folder is named because it is the one path you
// could not otherwise find.
function missingCwdMessage(cwd, transcriptFile) {
  const lines = [
    `${cwd} no longer exists — claude --resume looks a session up from the directory it was started in.`,
    'Recreate the directory and try again.',
  ];
  if (transcriptFile) {
    lines.push(
      'If the project moved, start a session at its new location once, then move the contents of',
      `  ${path.dirname(transcriptFile)}`,
      'into the folder Claude Code created for it.',
    );
  }
  return lines.join('\n');
}

function preview(text, width) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
}

// ---------------------------------------------------------------- cache

function loadCache(root) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(root, 'fork-tree-cache.json'), 'utf8'));
    if (c && c.version === CACHE_VERSION && c.files) return c;
  } catch { /* cold or stale cache */ }
  return { version: CACHE_VERSION, files: {} };
}

function saveCache(root, cache) {
  try {
    fs.writeFileSync(path.join(root, 'fork-tree-cache.json'), JSON.stringify(cache), 'utf8');
  } catch { /* a cache we cannot persist is still correct, only slower */ }
}

function cacheEntry(cache, file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const prev = cache.files[file];
  if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) return prev;
  const fresh = { size: st.size, mtimeMs: st.mtimeMs };
  cache.files[file] = fresh;
  return fresh;
}

// Drops the entries for transcripts that are gone. Nothing reads a stale entry
// — every lookup starts from the files on disk — but nothing else removes one
// either, and the cache would otherwise grow with every session ever seen.
function pruneCache(cache, transcripts) {
  const keep = new Set(transcripts.map((t) => t.file));
  for (const file of Object.keys(cache.files)) {
    if (!keep.has(file)) delete cache.files[file];
  }
}

// ---------------------------------------------------------------- hand-offs

// fork-at hands the window everything it needs in a file under fork-pending/,
// and the window deletes it as it starts. A window that never started leaves
// its file behind for good — nothing else would ever touch it — so both
// scripts sweep the folder as they start. The cutoff is generous: a window
// reads its hand-off within seconds of opening, so anything this old belongs
// to a window that is not coming.
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

function pendingDir(root) {
  return path.join(root, 'fork-pending');
}

function sweepPending(root, { now = Date.now(), maxAgeMs = PENDING_MAX_AGE_MS } = {}) {
  let names;
  try { names = fs.readdirSync(pendingDir(root)); } catch { return []; }
  const swept = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(pendingDir(root), name);
    try {
      if (now - fs.statSync(file).mtimeMs < maxAgeMs) continue;
      fs.unlinkSync(file);
      swept.push(file);
    } catch { /* picked up meanwhile, or not ours to remove */ }
  }
  return swept;
}

// ---------------------------------------------------------------- edges

// The marker must be anchored to a real message row, never matched against raw
// file text: any transcript that merely *discusses* a fork — documentation, a
// design conversation, this script's own output quoted in a tool result —
// contains the same string and would otherwise register as a fork of itself.
// A cheap substring probe still skips non-fork transcripts without parsing.
//
// The LAST signal wins, not the first. A fork's transcript opens with a copy of
// its parent's history, so a fork of a fork carries its parent's own marker or
// stamp ahead of its own. The first match names the grandparent.
function scanForEdge(file, child) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  if (!text.includes('"forkedFrom"') && !text.includes('[fork] parent=')) return null;

  let found = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }

    if (d.forkedFrom && d.forkedFrom.sessionId && d.forkedFrom.sessionId !== child) {
      found = { parent: d.forkedFrom.sessionId, cut: d.forkedFrom.messageUuid, source: 'branch' };
      continue;
    }
    if (d.type !== 'user' || d.isSidechain === true) continue;
    const c = d.message && d.message.content;
    if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) continue;
    const m = MARKER.exec(promptText(d).trim());
    // Anchored at position 0: the injected fork prompt opens with the marker.
    if (m && m.index === 0 && m[1] !== child) {
      found = { parent: m[1], cut: m[2], source: 'marker' };
    }
  }
  return found;
}

// child -> { parent, cut, source }. Ledger first, then the transcripts
// themselves fill any gap: /branch writes a native forkedFrom stamp and
// /fork-at leaves a [fork] marker, so either rebuilds a missing edge.
function collectEdges(root, cache) {
  const edges = new Map();

  const ledger = path.join(root, 'fork-tree.jsonl');
  if (fs.existsSync(ledger)) {
    for (const line of fs.readFileSync(ledger, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.child && e.parent) edges.set(e.child, { parent: e.parent, cut: e.cutUuid, source: 'ledger' });
      } catch { /* skip */ }
    }
  }

  for (const { sessionId, file } of listTranscripts(root)) {
    if (edges.has(sessionId)) continue;
    const entry = cache && cacheEntry(cache, file);
    if (entry && 'edge' in entry) {
      if (entry.edge) edges.set(sessionId, entry.edge);
      continue;
    }
    const found = scanForEdge(file, sessionId);
    if (entry) entry.edge = found;
    if (found) edges.set(sessionId, found);
  }
  return edges;
}

// ---------------------------------------------------------------- metadata

// Title preference: the last custom-title row (/rename, or the --name a fork
// is created with) wherever it sits, then the last ai-title row, then the
// last-prompt row, then the first typed prompt.
function sessionMeta(file, cache) {
  const entry = cache && cacheEntry(cache, file);
  if (entry && entry.meta) return entry.meta;

  const meta = { title: '', turns: 0, lastTs: null, cwd: null };
  let custom = '';
  let lastPrompt = '';
  let firstHuman = '';
  try {
    for (const d of readRows(file)) {
      if (d.type === 'custom-title' && d.customTitle) custom = d.customTitle;
      else if (d.type === 'ai-title' && d.aiTitle) meta.title = d.aiTitle;
      else if (d.type === 'last-prompt' && d.lastPrompt) lastPrompt = d.lastPrompt;
      if (d.timestamp) meta.lastTs = d.timestamp;
      if (d.cwd && !meta.cwd) meta.cwd = d.cwd;
      if (isHumanPrompt(d)) {
        meta.turns += 1;
        if (!firstHuman) firstHuman = promptText(d);
      }
    }
  } catch { /* unreadable transcript still gets a placeholder row */ }

  if (custom) meta.title = custom;
  else if (!meta.title) meta.title = preview(lastPrompt || firstHuman, 60);
  if (entry) entry.meta = meta;
  return meta;
}

// Sessions currently running. The registry keeps stale entries — the same
// sessionId appears under several pid files — so keep the newest per session
// and only trust it if the process is still alive.
function liveSessions(root) {
  const dir = path.join(root, 'sessions');
  const newest = new Map();
  let files;
  try { files = fs.readdirSync(dir); } catch { return new Set(); }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    if (!d.sessionId || !d.pid) continue;
    const prev = newest.get(d.sessionId);
    if (!prev || (d.updatedAt || 0) > (prev.updatedAt || 0)) newest.set(d.sessionId, d);
  }
  const live = new Set();
  for (const [sid, d] of newest) {
    try { process.kill(d.pid, 0); live.add(sid); } catch { /* process is gone */ }
  }
  return live;
}

// ---------------------------------------------------------------- terminal

function which(cmd) {
  try { execSync(`command -v ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; }
}

// A session we launch is independent, not nested inside the one launching it.
// These variables are set by Claude Code for its own child processes, and this
// script runs as one of them, so they would otherwise be inherited. The
// important one is CLAUDE_CODE_CHILD_SESSION: a session that sees it treats
// itself as nested and stops writing its transcript, which would silently make
// the fork unresumable. The messaging socket and token would also point the new
// session at the launching session's IPC channel.
const INHERITED_SESSION_VARS = [
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SKIP_PROMPT_HISTORY',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_PID',
  'CLAUDECODE',
  'AI_AGENT',
];

function cleanEnv() {
  const env = { ...process.env };
  for (const k of INHERITED_SESSION_VARS) delete env[k];
  return env;
}

// The binary to launch. Claude Code sets CLAUDE_CODE_EXECPATH for its own child
// processes, so inside a session this is the exact binary that is running; from
// a plain shell it falls back to whatever PATH resolves.
function claudeExe() {
  return process.env.CLAUDE_CODE_EXECPATH || 'claude';
}

// Whether spawning `exe` needs a shell. Only Windows does, and only for a name
// that is not a real executable: a bare `claude` may resolve to an npm
// `claude.cmd` shim, and a .cmd or .bat file cannot be started without cmd.exe.
// Everywhere else the binary is spawned directly, with no shell to quote for.
function needsShell(exe, platform = process.platform) {
  return platform === 'win32' && !/\.exe$/i.test(exe);
}

// A resume command for a terminal we spawn ourselves. It names the resolved
// binary, because the window we open inherits no PATH guarantee from us, and
// quotes it only when the path carries a space, so the bare fallback stays
// byte-identical to what this produced before.
// What gets PRINTED for you to run later is deliberately not this: that stays
// a plain "claude", which resolves against your own PATH and cannot go stale
// the way a recorded absolute path can.
function resumeCommand(sessionId) {
  return `${quoteIfSpaced(claudeExe())} --resume ${sessionId}`;
}

// Double quotes around a path that needs them, in a form both sh and cmd.exe
// read. Only for paths and ids: it escapes nothing inside.
function quoteIfSpaced(s) {
  return /\s/.test(s) ? `"${s}"` : s;
}

// One argument for sh, whatever it contains.
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// The command a new window runs: `cmd`, from `cwd`.
//
// A window does not reliably start where we are. Terminal.app, iTerm and
// gnome-terminal open in your home directory, and a session resumed from the
// wrong directory is looked up in the wrong project. So the window changes
// directory itself rather than trusting the one it inherits.
function terminalCommand(cmd, cwd, platform = process.platform) {
  if (!cwd) return cmd;
  return platform === 'win32' ? `cd /d "${cwd}" && ${cmd}` : `cd ${shq(cwd)} && ${cmd}`;
}

// cmd /k strips the first and last quote of its command line when the line
// holds more than one pair — which a quoted path plus a quoted argument does.
// One extra outer pair is what it strips, leaving the command intact.
function windowsStartCommand(full) {
  return `start "" cmd /k "${full}"`;
}

function openTerminal(cmd, cwd) {
  const env = cleanEnv();
  const dir = cwd && fs.existsSync(cwd) ? cwd : null;
  const full = terminalCommand(cmd, dir);
  const opts = { detached: true, stdio: 'ignore', env, ...(dir ? { cwd: dir } : {}) };
  const tmpl = process.env.FORK_AT_TERMINAL;
  if (tmpl) {
    spawn(tmpl.replace('{cmd}', full), { ...opts, shell: true }).unref();
    return 'FORK_AT_TERMINAL';
  }
  if (process.platform === 'win32') {
    spawn(windowsStartCommand(full), { ...opts, shell: true }).unref();
    return 'new cmd window';
  }
  if (process.platform === 'darwin') {
    const iterm = process.env.TERM_PROGRAM === 'iTerm.app';
    // The command goes inside an AppleScript string literal, and a quoted exe
    // path would otherwise close it early.
    const esc = full.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = iterm
      ? `tell application "iTerm" to create window with default profile command "${esc}"`
      : `tell application "Terminal" to do script "${esc}"`;
    spawn('osascript', ['-e', script], opts).unref();
    return iterm ? 'new iTerm window' : 'new Terminal.app window';
  }
  const inner = `${full}; exec "\${SHELL:-sh}"`;
  for (const term of [process.env.TERMINAL, 'x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm'].filter(Boolean)) {
    if (!which(term)) continue;
    const args = term === 'gnome-terminal' ? ['--', 'sh', '-c', inner] : ['-e', `sh -c ${shq(inner)}`];
    spawn(term, args, opts).unref();
    return term;
  }
  return null;
}

module.exports = {
  MARKER,
  CliError,
  runMain,
  configRoot,
  listTranscripts,
  findTranscript,
  readRows,
  isHumanPrompt,
  promptText,
  sessionCwd,
  missingCwdMessage,
  preview,
  loadCache,
  saveCache,
  pruneCache,
  pendingDir,
  sweepPending,
  collectEdges,
  scanForEdge,
  sessionMeta,
  liveSessions,
  openTerminal,
  cleanEnv,
  claudeExe,
  needsShell,
  resumeCommand,
  quoteIfSpaced,
  shq,
  terminalCommand,
  windowsStartCommand,
};
