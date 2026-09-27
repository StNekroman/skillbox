const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const G = require('../lib/fork-graph');
const { id, Transcript, tempRoot, writeTranscript, writeLedger, withEnv } = require('./helpers');

const marker = (parent, cut) => `[fork] parent=${parent} cut=${cut}\n\nWait for next user's input.`;

describe('isHumanPrompt', () => {
  test('a typed prompt is human; a tool result, a -p prompt and a sidechain row are not', () => {
    const t = new Transcript();
    assert.equal(Boolean(G.isHumanPrompt(t.human('hi'))), true);
    assert.equal(Boolean(G.isHumanPrompt(t.toolResult('out'))), false);
    assert.equal(Boolean(G.isHumanPrompt(t.headless('from -p'))), false);
    assert.equal(Boolean(G.isHumanPrompt({ ...t.human('side'), isSidechain: true })), false);
    assert.equal(Boolean(G.isHumanPrompt(t.assistant('answer'))), false);
  });
});

describe('promptText', () => {
  test('drops IDE and reminder blocks, keeps what was typed', () => {
    const row = {
      message: {
        content: [
          { type: 'text', text: '<ide_opened_file>The user opened a file</ide_opened_file>' },
          { type: 'text', text: '<system-reminder>noise</system-reminder>' },
          { type: 'text', text: 'the real question' },
        ],
      },
    };
    assert.equal(G.promptText(row), 'the real question');
  });

  test('a string body is returned as is; anything else is empty', () => {
    assert.equal(G.promptText({ message: { content: 'plain' } }), 'plain');
    assert.equal(G.promptText({ message: {} }), '');
    assert.equal(G.promptText({}), '');
  });
});

describe('preview', () => {
  test('flattens whitespace and truncates with an ellipsis', () => {
    assert.equal(G.preview('a\n\n  b', 10), 'a b');
    assert.equal(G.preview('abcdefghij', 5), 'abcd…');
    assert.equal(G.preview(null, 5), '');
  });
});

describe('scanForEdge', () => {
  const P = id(1, 0xa);
  const Q = id(1, 0xb);
  const CHILD = id(1, 0xc);

  function scan(t, rows) {
    const root = tempRoot(t);
    const file = writeTranscript(root, CHILD, rows.map((r) => JSON.stringify(r)).join('\n'));
    return G.scanForEdge(file, CHILD);
  }

  test('a transcript with no fork signal has no edge', (t) => {
    const tr = new Transcript();
    tr.turn('hello', 'hi');
    assert.equal(scan(t, tr.rows), null);
  });

  test('a -p prompt opening with the marker is an edge', (t) => {
    const tr = new Transcript();
    tr.turn('hello', 'hi');
    tr.headless(marker(P, id(3)));
    assert.deepEqual(scan(t, tr.rows), { parent: P, cut: id(3), source: 'marker' });
  });

  test('a native forkedFrom stamp is an edge', (t) => {
    const tr = new Transcript();
    tr.add({ type: 'user', origin: { kind: 'human' }, message: { content: 'x' }, forkedFrom: { sessionId: P, messageUuid: id(2) } });
    assert.deepEqual(scan(t, tr.rows), { parent: P, cut: id(2), source: 'branch' });
  });

  test('a marker quoted in a tool result is not an edge', (t) => {
    const tr = new Transcript();
    tr.human('show me the ledger');
    tr.toolUse();
    tr.add({ type: 'user', message: { content: [{ type: 'tool_result', content: marker(P, id(3)) }, { type: 'text', text: marker(P, id(3)) }] } });
    assert.equal(scan(t, tr.rows), null);
  });

  test('a marker mentioned mid-sentence is not an edge', (t) => {
    const tr = new Transcript();
    tr.human(`the child opens with ${marker(P, id(3))}`);
    assert.equal(scan(t, tr.rows), null);
  });

  test('a marker naming the transcript itself is not an edge', (t) => {
    const tr = new Transcript();
    tr.headless(marker(CHILD, id(3)));
    assert.equal(scan(t, tr.rows), null);
  });

  // A fork's transcript opens with a copy of its parent's history, so a fork
  // of a fork holds its parent's marker first and its own second.
  test('a fork of a fork names its own parent, not the grandparent', (t) => {
    const tr = new Transcript();
    tr.turn('hello', 'hi');
    tr.headless(marker(P, id(3))); // inherited: Q was forked from P
    tr.turn('more', 'sure');
    tr.headless(marker(Q, id(7))); // this transcript's own fork, from Q
    assert.deepEqual(scan(t, tr.rows), { parent: Q, cut: id(7), source: 'marker' });
  });

  test('an inherited forkedFrom stamp loses to a later marker', (t) => {
    const tr = new Transcript();
    tr.add({ type: 'user', origin: { kind: 'human' }, message: { content: 'x' }, forkedFrom: { sessionId: P, messageUuid: id(1) } });
    tr.headless(marker(Q, id(2)));
    assert.equal(scan(t, tr.rows).parent, Q);
  });

  test('corrupt lines are skipped', (t) => {
    const root = tempRoot(t);
    const file = writeTranscript(root, CHILD, `{not json\n${JSON.stringify(new Transcript().headless(marker(P, id(3))))}\n`);
    assert.equal(G.scanForEdge(file, CHILD).parent, P);
  });
});

describe('collectEdges', () => {
  const A = id(1, 0xa);
  const B = id(1, 0xb);
  const C = id(1, 0xc);
  const X = id(1, 0xd);

  test('the ledger wins over the transcript for the same child', (t) => {
    const root = tempRoot(t);
    writeLedger(root, [[A, B]]);
    const tb = new Transcript();
    tb.headless(marker(X, id(1)));
    writeTranscript(root, B, tb);
    const edges = G.collectEdges(root, G.loadCache(root));
    assert.equal(edges.get(B).parent, A);
    assert.equal(edges.get(B).source, 'ledger');
  });

  test('a child missing from the ledger is rebuilt from its transcript', (t) => {
    const root = tempRoot(t);
    writeLedger(root, [[A, B]]);
    const tc = new Transcript();
    tc.headless(marker(B, id(1)));
    writeTranscript(root, C, tc);
    const edges = G.collectEdges(root, G.loadCache(root));
    assert.deepEqual([...edges.keys()].sort(), [B, C].sort());
    assert.equal(edges.get(C).source, 'marker');
  });

  test('a cached scan is reused until the file changes', (t) => {
    const root = tempRoot(t);
    const tc = new Transcript();
    tc.headless(marker(B, id(1)));
    const file = writeTranscript(root, C, tc);
    const cache = G.loadCache(root);
    G.collectEdges(root, cache);
    assert.equal(cache.files[file].edge.parent, B);

    // Same size and mtime: the cached edge is trusted, even though it is now wrong.
    cache.files[file].edge = { parent: X, cut: id(1), source: 'marker' };
    assert.equal(G.collectEdges(root, cache).get(C).parent, X);

    // A changed file is rescanned.
    fs.appendFileSync(file, '\n');
    assert.equal(G.collectEdges(root, cache).get(C).parent, B);
  });

  test('no projects directory means no edges', (t) => {
    assert.equal(G.collectEdges(tempRoot(t), null).size, 0);
  });
});

describe('cache', () => {
  test('round-trips, and a version mismatch starts cold', (t) => {
    const root = tempRoot(t);
    G.saveCache(root, { version: 3, files: { f: { size: 1 } } });
    assert.deepEqual(G.loadCache(root).files, { f: { size: 1 } });
    fs.writeFileSync(path.join(root, 'fork-tree-cache.json'), JSON.stringify({ version: 1, files: { f: {} } }));
    assert.deepEqual(G.loadCache(root).files, {});
  });
});

describe('sessionMeta', () => {
  const S = id(1, 0xe);

  test('prefers the custom title, then ai-title, then last-prompt, then the first prompt', (t) => {
    const root = tempRoot(t);
    const tr = new Transcript();
    tr.human('first prompt');
    tr.meta({ type: 'last-prompt', lastPrompt: 'last prompt' });
    const file = writeTranscript(root, S, tr);
    assert.equal(G.sessionMeta(file, null).title, 'last prompt');

    tr.meta({ type: 'ai-title', aiTitle: 'Old title' });
    tr.meta({ type: 'ai-title', aiTitle: 'Real title' });
    writeTranscript(root, S, tr);
    assert.equal(G.sessionMeta(file, null).title, 'Real title');

    // A fork is created with --name, which lands as a custom-title row; the
    // ai-title copied from the parent may follow it and must not win.
    tr.meta({ type: 'custom-title', customTitle: 'Fork: my name' });
    tr.meta({ type: 'ai-title', aiTitle: 'Later ai title' });
    writeTranscript(root, S, tr);
    assert.equal(G.sessionMeta(file, null).title, 'Fork: my name');

    const plain = new Transcript();
    plain.human('only prompt');
    writeTranscript(root, S, plain);
    assert.equal(G.sessionMeta(file, null).title, 'only prompt');
  });

  test('counts only human turns, and records the first cwd and last timestamp', (t) => {
    const root = tempRoot(t);
    const tr = new Transcript();
    tr.add({ type: 'user', origin: { kind: 'human' }, message: { content: 'a' }, cwd: '/one' });
    tr.toolResult('x');
    tr.headless('from -p');
    const last = tr.add({ type: 'user', origin: { kind: 'human' }, message: { content: 'b' }, cwd: '/two' });
    const meta = G.sessionMeta(writeTranscript(root, S, tr), null);
    assert.equal(meta.turns, 2);
    assert.equal(meta.cwd, '/one');
    assert.equal(meta.lastTs, last.timestamp);
  });
});

describe('liveSessions', () => {
  test('keeps the newest registry entry per session, and only a live pid', (t) => {
    const root = tempRoot(t);
    const dir = path.join(root, 'sessions');
    fs.mkdirSync(dir);
    const dead = 2 ** 22 + 12345; // above any default pid_max
    const write = (name, d) => fs.writeFileSync(path.join(dir, name), JSON.stringify(d));
    write('1.json', { sessionId: 'alive', pid: process.pid, updatedAt: 1 });
    write('2.json', { sessionId: 'gone', pid: dead, updatedAt: 1 });
    // Stale entry for a session whose newest registration points at a dead pid.
    write('3.json', { sessionId: 'restarted', pid: process.pid, updatedAt: 1 });
    write('4.json', { sessionId: 'restarted', pid: dead, updatedAt: 2 });
    write('junk.json', '{nope');
    write('ignored.txt', { sessionId: 'x', pid: process.pid });
    assert.deepEqual([...G.liveSessions(root)], ['alive']);
  });

  test('no registry directory means nothing is live', (t) => {
    assert.equal(G.liveSessions(tempRoot(t)).size, 0);
  });
});

describe('needsShell', () => {
  test('only Windows, and only for something that is not an .exe', () => {
    assert.equal(G.needsShell('claude', 'win32'), true);
    assert.equal(G.needsShell('C:\\npm\\claude.cmd', 'win32'), true);
    assert.equal(G.needsShell('C:\\bin\\claude.EXE', 'win32'), false);
    assert.equal(G.needsShell('claude', 'linux'), false);
    assert.equal(G.needsShell('claude', 'darwin'), false);
  });
});

describe('resumeCommand and claudeExe', () => {
  test('falls back to a bare claude', (t) => {
    withEnv(t, { CLAUDE_CODE_EXECPATH: undefined });
    assert.equal(G.claudeExe(), 'claude');
    assert.equal(G.resumeCommand('abc'), 'claude --resume abc');
  });

  test('quotes a resolved binary only when its path has a space', (t) => {
    withEnv(t, { CLAUDE_CODE_EXECPATH: 'C:\\Program Files\\claude.exe' });
    assert.equal(G.resumeCommand('abc'), '"C:\\Program Files\\claude.exe" --resume abc');
    process.env.CLAUDE_CODE_EXECPATH = '/usr/bin/claude';
    assert.equal(G.resumeCommand('abc'), '/usr/bin/claude --resume abc');
  });
});

describe('cleanEnv', () => {
  test('strips the variables that would make a launched session look nested', (t) => {
    withEnv(t, { CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDECODE: '1', SKILLBOX_KEEP: 'yes' });
    const env = G.cleanEnv();
    assert.equal(env.CLAUDE_CODE_CHILD_SESSION, undefined);
    assert.equal(env.CLAUDE_CODE_SESSION_ID, undefined);
    assert.equal(env.CLAUDECODE, undefined);
    assert.equal(env.SKILLBOX_KEEP, 'yes');
    assert.equal(process.env.CLAUDE_CODE_CHILD_SESSION, '1', 'the running process is untouched');
  });
});

describe('listTranscripts', () => {
  test('only depth-1 .jsonl files are sessions', (t) => {
    const root = tempRoot(t);
    writeTranscript(root, 'sess-a', '');
    const sidecar = path.join(root, 'projects', 'd--proj', 'sess-a', 'subagents');
    fs.mkdirSync(sidecar, { recursive: true });
    fs.writeFileSync(path.join(sidecar, 'agent.jsonl'), '');
    fs.writeFileSync(path.join(root, 'projects', 'd--proj', 'notes.txt'), '');
    assert.deepEqual(G.listTranscripts(root).map((x) => x.sessionId), ['sess-a']);
    assert.ok(G.findTranscript(root, 'sess-a').endsWith('sess-a.jsonl'));
    assert.equal(G.findTranscript(root, 'nope'), null);
  });
});

describe('sessionCwd', () => {
  test('the first directory the session recorded', () => {
    const t = new Transcript(0, '/work/project');
    t.turn('hi', 'hello');
    t.add({ type: 'user', origin: { kind: 'human' }, message: { content: 'x' }, cwd: '/later/elsewhere' });
    assert.equal(G.sessionCwd(t.rows), '/work/project');
    assert.equal(G.sessionCwd([{ type: 'ai-title' }, { cwd: '' }]), null);
  });
});

describe('quoting', () => {
  test('quoteIfSpaced leaves plain words alone', () => {
    assert.equal(G.quoteIfSpaced('claude'), 'claude');
    assert.equal(G.quoteIfSpaced('C:\\Program Files\\x.exe'), '"C:\\Program Files\\x.exe"');
  });

  test('shq survives a single quote', () => {
    assert.equal(G.shq("it's"), `'it'\\''s'`);
  });

  test('terminalCommand changes directory in the syntax of each shell', () => {
    assert.equal(G.terminalCommand('claude --resume x', 'D:\\My Proj', 'win32'), 'cd /d "D:\\My Proj" && claude --resume x');
    assert.equal(G.terminalCommand('claude --resume x', "/home/me/it's", 'linux'), `cd '/home/me/it'\\''s' && claude --resume x`);
    assert.equal(G.terminalCommand('claude', null, 'linux'), 'claude');
  });

  test('windowsStartCommand adds the outer pair cmd /k strips', () => {
    assert.equal(G.windowsStartCommand('"a b" "c"'), 'start "" cmd /k ""a b" "c""');
  });
});

describe('the window command, run by a real shell', () => {
  // A directory and a script whose paths carry the characters that break
  // naive quoting: a space everywhere, a quote on POSIX.
  function fixture(t, dirName) {
    const dir = path.join(tempRoot(t), dirName);
    fs.mkdirSync(dir);
    const script = path.join(dir, 'echo args.js');
    fs.writeFileSync(script, 'console.log(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }))');
    const cmd = [G.quoteIfSpaced(process.execPath), G.quoteIfSpaced(script), '--finish', G.quoteIfSpaced(path.join(dir, 'spec file.json'))].join(' ');
    return { dir, cmd };
  }
  const { spawnSync } = require('child_process');

  test('cmd.exe runs the wrapped command from the session directory', { skip: process.platform !== 'win32' }, (t) => {
    const { dir, cmd } = fixture(t, 'my project');
    // What `start "" cmd /k …` hands to cmd, with /c so it returns.
    const full = G.windowsStartCommand(G.terminalCommand(cmd, dir, 'win32')).replace(/^start "" cmd \/k /, '');
    const res = spawnSync('cmd.exe', ['/d', '/c', full], { windowsVerbatimArguments: true, encoding: 'utf8' });
    const out = JSON.parse(res.stdout.trim());
    assert.deepEqual(out.argv, ['--finish', path.join(dir, 'spec file.json')]);
    assert.equal(out.cwd.toLowerCase(), dir.toLowerCase());
  });

  test('sh runs the command from a directory with a quote in its name', { skip: process.platform === 'win32' }, (t) => {
    const { dir, cmd } = fixture(t, "it's here");
    const res = spawnSync('sh', ['-c', G.terminalCommand(cmd, dir, process.platform)], { encoding: 'utf8' });
    const out = JSON.parse(res.stdout.trim());
    assert.deepEqual(out.argv, ['--finish', path.join(dir, 'spec file.json')]);
    assert.equal(fs.realpathSync(out.cwd), fs.realpathSync(dir));
  });
});
