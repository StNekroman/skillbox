// End to end: the scripts as the slash commands run them, against a fake
// config directory. fork-at only ever runs with --dry-run here, and fork-tree
// never with a valid --open, so nothing is launched.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const { Transcript, tempRoot, writeTranscript, writeLedger } = require('./helpers');

const SCRIPTS = path.join(__dirname, '..');
const SID = 'abcdef12-0000-4000-8000-000000000001';

function run(script, args, env) {
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('CLAUDE')) delete clean[k];
  return spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
    encoding: 'utf8',
    env: { ...clean, NO_COLOR: '1', ...env },
  });
}

function forkSession(t) {
  const root = tempRoot(t);
  const tr = new Transcript();
  tr.turn('Plan `B3`’s cache layer', 'Use an LRU.');
  tr.turn('What about eviction?', 'Evict on write.');
  tr.command('skillbox-fork:fork-at', 'whatever');
  writeTranscript(root, SID, tr);
  return { root, env: { CLAUDE_CONFIG_DIR: root, CLAUDE_CODE_SESSION_ID: SID, CLAUDE_CODE_EXECPATH: '/opt/claude/claude.exe' } };
}

describe('fork-at.js', () => {
  test('dry run with an apostrophe and a directive in one quoted argument', (t) => {
    const { env } = forkSession(t);
    const res = run('fork-at.js', ["--dry-run B3's cache -- try the other approach"], env);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /matched\s+turn 1 of 2 .*\(matched in your prompt\)/);
    assert.match(res.stdout, /directive "try the other approach"/);
    assert.match(res.stdout, /would run\n\s+\/opt\/claude\/claude\.exe -p --resume abcdef12-/);
    assert.match(res.stdout, /--name fork-abcdef12 <prompt>/);
    assert.match(res.stdout, /prompt\n\s+\[fork\] parent=abcdef12-\S+ cut=\S+\n\s*\n\s+try the other approach/);
  });

  test('no match exits 1 with the candidates on stderr', (t) => {
    const { env } = forkSession(t);
    const res = run('fork-at.js', ['--dry-run', 'zebra'], env);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: nothing matches "zebra"/);
    assert.match(res.stderr, /pick one: {3}\/fork-at @/);
    assert.equal(res.stdout, '');
  });

  test('refuses to run outside a session', (t) => {
    const { root } = forkSession(t);
    const res = run('fork-at.js', ['--dry-run'], { CLAUDE_CONFIG_DIR: root });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /CLAUDE_CODE_SESSION_ID is not set/);
  });

  test('a session with no transcript is reported, not crashed on', (t) => {
    const { env } = forkSession(t);
    const res = run('fork-at.js', ['--dry-run'], { ...env, CLAUDE_CODE_SESSION_ID: 'ffffffff-0000-4000-8000-000000000000' });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: no transcript for session/);
  });
});

describe('fork-tree.js', () => {
  const PARENT = 'aaaa0000-0000-4000-8000-000000000001';
  const CHILD = 'bbbb0000-0000-4000-8000-000000000002';

  function tree(t) {
    const root = tempRoot(t);
    for (const [sid, title] of [[PARENT, 'Parent session'], [CHILD, 'Child session']]) {
      const tr = new Transcript();
      tr.turn('hello', 'hi');
      tr.meta({ type: 'ai-title', aiTitle: title });
      writeTranscript(root, sid, tr);
    }
    writeLedger(root, [[PARENT, CHILD]]);
    return root;
  }

  test('static view from inside the child, flags passed as one quoted argument', (t) => {
    const root = tree(t);
    const res = run('fork-tree.js', ['--static --no-color'], { CLAUDE_CONFIG_DIR: root, CLAUDE_CODE_SESSION_ID: CHILD });
    assert.equal(res.status, 0, res.stderr);
    const lines = res.stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^\s+1\s+aaaa0000\s+Parent session\s+\[1 turn\]/);
    assert.match(lines[1], /^\s+2\s+● └─ bbbb0000\s+Child session.*\(you are here\)$/);
  });

  test('from a plain shell it lists the whole forest', (t) => {
    const root = tree(t);
    const res = run('fork-tree.js', ['--static'], { CLAUDE_CONFIG_DIR: root });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /aaaa0000[\s\S]*└─ bbbb0000/);
    assert.doesNotMatch(res.stdout, /you are here/);
  });

  test('an out-of-range --open exits 1 without launching anything', (t) => {
    const root = tree(t);
    const res = run('fork-tree.js', ['--open 9'], { CLAUDE_CONFIG_DIR: root, CLAUDE_CODE_SESSION_ID: CHILD });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: no node numbered 9/);
  });

  test('an empty config directory has no forks', (t) => {
    const res = run('fork-tree.js', ['--static'], { CLAUDE_CONFIG_DIR: tempRoot(t) });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /no forks recorded yet/);
  });
});
