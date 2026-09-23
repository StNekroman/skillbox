#!/usr/bin/env node
// Renders the fork tree around a session: ancestors up to the root, descendants all the way down.
// Usage: node <plugin>/scripts/fork-tree.js [session-id | search text] [--full] [--open N] [--no-color]
//        Run directly in a terminal for an interactive picker.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const G = require('./lib/fork-graph');

// ---------------------------------------------------------------- formatting

const TTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
let COLOR = TTY && !process.env.NO_COLOR;
const c = {
  dim: (s) => (COLOR ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (COLOR ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s) => (COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  cyan: (s) => (COLOR ? `\x1b[36m${s}\x1b[0m` : s),
};

function age(ts) {
  if (!ts) return '';
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------- graph

function invert(edges) {
  const kids = new Map();
  for (const [child, e] of edges) {
    if (e.parent === child) continue; // self-edge is never a real fork
    if (!kids.has(e.parent)) kids.set(e.parent, []);
    kids.get(e.parent).push(child);
  }
  return kids;
}

// Root-most first, focus excluded. Guarded so a corrupt ledger cannot loop.
function ancestorsOf(edges, focus) {
  const chain = [];
  const seen = new Set([focus]);
  let cur = focus;
  for (;;) {
    const e = edges.get(cur);
    if (!e || !e.parent || seen.has(e.parent)) break;
    chain.unshift(e.parent);
    seen.add(e.parent);
    cur = e.parent;
  }
  return chain;
}

// ---------------------------------------------------------------- rows

function buildRows(edges, kids, focus, full) {
  const chain = ancestorsOf(edges, focus);
  const rows = [];

  const push = (id, prefix) => rows.push({ id, prefix });

  const walkDown = (id, indent, isLast, seen) => {
    push(id, `${indent}${isLast ? '└─ ' : '├─ '}`);
    if (seen.has(id)) {
      rows.push({ cycle: true, prefix: `${indent}   ` });
      return;
    }
    seen.add(id);
    const list = kids.get(id) || [];
    list.forEach((k, i) => walkDown(k, indent + (isLast ? '   ' : '│  '), i === list.length - 1, seen));
  };

  if (full) {
    const root = chain.length ? chain[0] : focus;
    push(root, '');
    const list = kids.get(root) || [];
    const seen = new Set([root]);
    list.forEach((k, i) => walkDown(k, '', i === list.length - 1, seen));
    return rows;
  }

  // Focused: the ancestor spine has no siblings, then the focus subtree in full.
  let indent = '';
  chain.forEach((id, i) => {
    if (i === 0) push(id, '');
    else {
      push(id, `${indent}└─ `);
      indent += '   ';
    }
  });
  if (chain.length === 1) indent = '';

  if (chain.length) {
    push(focus, `${indent}└─ `);
    indent += '   ';
  } else push(focus, '');

  const list = kids.get(focus) || [];
  const seen = new Set([...chain, focus]);
  list.forEach((k, i) => walkDown(k, indent, i === list.length - 1, seen));
  return rows;
}

function decorate(rows, root, cache, edges, focus, live, focusCwd) {
  const files = new Map(G.listTranscripts(root).map((t) => [t.sessionId, t]));
  return rows.map((r) => {
    if (r.cycle) return { ...r, text: c.dim('↑ cycle') };
    const t = files.get(r.id);
    const meta = t
      ? G.sessionMeta(t.file, cache)
      : { title: '(transcript not found)', turns: 0, lastTs: null, cwd: null };
    // Fields stay plain here. Colour is applied at render time, after padding,
    // because ANSI escapes count toward string length and would break every
    // column they appear in.
    const tags = [];
    if (live.has(r.id)) tags.push('live');
    const e = edges.get(r.id);
    if (e && e.source && e.source !== 'ledger') tags.push(e.source);
    if (meta.cwd && focusCwd && meta.cwd.toLowerCase() !== focusCwd.toLowerCase()) {
      tags.push(path.basename(meta.cwd));
    }
    return {
      ...r,
      isFocus: r.id === focus,
      short: r.id.slice(0, 8),
      title: G.preview(meta.title, 52) || '(untitled)',
      turns: meta.turns ? `[${meta.turns} turn${meta.turns === 1 ? '' : 's'}]` : '',
      age: age(meta.lastTs),
      tags,
    };
  });
}

// Column widths from the data. The tree prefix is padded to the deepest row,
// which is what lets the hash, turn count and recency line up regardless of
// depth.
let W = { tree: 0, title: 0, turns: 0, age: 0 };
function layout(rows) {
  const body = rows.filter((r) => !r.cycle);
  const widest = (f) => body.reduce((m, r) => Math.max(m, (r[f] || '').length), 0);
  W = {
    // Tree lines and hash are one column, padded as a unit: the hash keeps its
    // indentation so the shape stays readable, while everything after it lines
    // up. Padding the lines separately would align the hashes and flatten the
    // tree.
    tree: body.reduce((m, r) => Math.max(m, (r.prefix || '').length + r.short.length), 0),
    title: widest('title'),
    turns: widest('turns'),
    age: widest('age'),
  };
}

function renderLine(r, index, selected) {
  const num = index === null ? '  ' : String(index).padStart(2);
  const cursor = selected === undefined ? ' ' : selected ? '>' : ' ';
  const lead = `${cursor} ${num}  `;
  if (r.cycle) return `${lead}  ${r.prefix}${c.dim('↑ cycle')}`;
  const line = [
    lead,
    r.isFocus ? '● ' : '  ',
    `${r.prefix}${r.short}`.padEnd(W.tree),
    '  ',
    r.title.padEnd(W.title),
    '  ',
    r.turns.padStart(W.turns),
    '  ',
    r.age.padEnd(W.age),
  ].join('');
  const tags = r.tags.map((t) => (t === 'live' ? c.green(t) : c.dim(t))).join(' ');
  const tail = `${tags ? `  ${tags}` : ''}${r.isFocus ? c.cyan('  (you are here)') : ''}`;
  // trimEnd only strips the column padding; ANSI resets are not whitespace.
  return `${r.isFocus || selected ? c.bold(line) : line}${tail}`.trimEnd();
}

// ---------------------------------------------------------------- focus

function resolveFocus(root, cache, arg) {
  const all = G.listTranscripts(root);
  if (arg) {
    const exact = all.find((t) => t.sessionId === arg);
    if (exact) return exact.sessionId;
    const pre = all.filter((t) => t.sessionId.startsWith(arg.toLowerCase()));
    if (pre.length === 1) return pre[0].sessionId;
    if (pre.length > 1) fail(`"${arg}" matches ${pre.length} sessions — use more characters`);
    const needle = arg.toLowerCase();
    const byTitle = all.filter((t) => G.sessionMeta(t.file, cache).title.toLowerCase().includes(needle));
    if (byTitle.length === 1) return byTitle[0].sessionId;
    if (byTitle.length > 1) {
      console.error(`"${arg}" matches ${byTitle.length} sessions:`);
      for (const t of byTitle.slice(0, 10)) {
        console.error(`  ${t.sessionId.slice(0, 8)}  ${G.preview(G.sessionMeta(t.file, cache).title, 60)}`);
      }
      process.exit(1);
    }
    fail(`no session matches "${arg}"`);
  }
  // Run from your own shell there is no session id, and "where I am" has no
  // meaning — guessing the most recent session for this directory just centres
  // the view on something you did not ask about. Return null and let the caller
  // show the whole forest, which is what you can actually navigate.
  return process.env.CLAUDE_CODE_SESSION_ID || null;
}

// Every root and all its descendants. Used when there is no focus session.
function buildForest(edges, kids) {
  const roots = [...new Set([...kids.keys()].filter((p) => !edges.has(p) || edges.get(p).parent === p))];
  const rows = [];
  const walk = (id, indent, isLast, isRoot, seen) => {
    rows.push({ id, prefix: isRoot ? '' : `${indent}${isLast ? '└─ ' : '├─ '}` });
    if (seen.has(id)) {
      rows.push({ cycle: true, prefix: `${indent}   ` });
      return;
    }
    seen.add(id);
    const list = kids.get(id) || [];
    list.forEach((k, i) =>
      walk(k, isRoot ? '' : indent + (isLast ? '   ' : '│  '), i === list.length - 1, false, seen),
    );
  };
  roots
    .sort((a, b) => (kids.get(b) || []).length - (kids.get(a) || []).length)
    .forEach((r) => walk(r, '', true, true, new Set()));
  return rows;
}

// ---------------------------------------------------------------- actions

function openSession(id, inPlace) {
  const exe = G.claudeExe();
  if (inPlace) {
    const res = spawnSync(exe, ['--resume', id], { stdio: 'inherit', shell: exe === 'claude', env: G.cleanEnv() });
    process.exit(res.status === null ? 1 : res.status);
  }
  const opened = G.openTerminal(G.resumeCommand(id));
  // A slash command cannot take over the terminal its own session is running
  // in, so it opens a window instead. Print the command too, for switching by
  // hand from a shell.
  console.log(opened ? `opened ${id} in ${opened}` : 'no terminal found');
  console.log(`to switch in place instead:  claude --resume ${id}`);
}

function interactive(rows, startIdx) {
  const pickable = rows.map((r, i) => (r.cycle ? -1 : i)).filter((i) => i >= 0);
  let pos = Math.max(0, pickable.indexOf(startIdx));

  // A fixed-height window. Redraw moves the cursor up a constant number of
  // lines, so the drawn block must never be taller than the terminal — with a
  // whole forest listed, it easily would be.
  const maxVis = Math.min(rows.length, Math.max(4, (process.stdout.rows || 24) - 3));
  const block = maxVis + 1;
  let top = 0;
  const draw = (first) => {
    const cur = pickable[pos];
    if (cur < top) top = cur;
    if (cur >= top + maxVis) top = cur - maxVis + 1;
    top = Math.max(0, Math.min(top, rows.length - maxVis));
    if (!first) process.stdout.write(`\x1b[${block}A`);
    for (let i = top; i < top + maxVis; i++) {
      process.stdout.write(`\x1b[2K${renderLine(rows[i], null, i === cur)}\n`);
    }
    const more = rows.length > maxVis ? `   ${top + 1}-${top + maxVis} of ${rows.length}` : '';
    process.stdout.write(`\x1b[2K${c.dim(`↑/↓ move   enter open here   q quit${more}`)}\n`);
  };

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  draw(true);

  process.stdin.on('keypress', (_s, key) => {
    if (!key) return;
    const done = (fn) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      fn();
    };
    if (key.name === 'up' || key.name === 'k') {
      pos = (pos - 1 + pickable.length) % pickable.length;
      draw(false);
    } else if (key.name === 'down' || key.name === 'j') {
      pos = (pos + 1) % pickable.length;
      draw(false);
    } else if (key.name === 'return') {
      const id = rows[pickable[pos]].id;
      done(() => openSession(id, true));
    } else if (key.name === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      done(() => process.exit(0));
    }
  });
}

// ---------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const flags = new Set();
  let openIdx = null;
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--full' || a === '--no-color' || a === '--static') {
      flags.add(a);
      continue;
    }
    if (a === '--open') {
      openIdx = parseInt(argv[++i], 10);
      continue;
    }
    words.push(a);
  }
  if (flags.has('--no-color')) COLOR = false;

  const root = G.configRoot();
  const cache = G.loadCache(root);
  const focus = resolveFocus(root, cache, words.join(' ').trim() || null);

  const edges = G.collectEdges(root, cache);
  const kids = invert(edges);

  const live = G.liveSessions(root);
  const focusFile = focus && G.findTranscript(root, focus);
  const focusCwd = focusFile ? G.sessionMeta(focusFile, cache).cwd : null;

  const raw = focus ? buildRows(edges, kids, focus, flags.has('--full')) : buildForest(edges, kids);
  if (!raw.length) {
    G.saveCache(root, cache);
    console.log('no forks recorded yet');
    return;
  }
  const rows = decorate(raw, root, cache, edges, focus, live, focusCwd);
  layout(rows);
  G.saveCache(root, cache);

  if (openIdx !== null) {
    const r = rows[openIdx - 1];
    if (!r || r.cycle) fail(`no node numbered ${openIdx}`);
    openSession(r.id, false);
    return;
  }

  if (focus && rows.length === 1) {
    console.log(renderLine(rows[0], null));
    console.log(c.dim('\nno forks recorded for this session yet'));
    return;
  }

  if (TTY && !flags.has('--static')) {
    interactive(
      rows,
      rows.findIndex((r) => r.isFocus),
    );
    return;
  }

  rows.forEach((r, i) => console.log(renderLine(r, r.cycle ? null : i + 1)));
}

main();
