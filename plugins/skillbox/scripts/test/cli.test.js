// End to end: the scripts as the slash commands run them, against a fake
// config directory and a fake claude binary (fixtures/fake-claude.js) that
// records how it was called. No model is called and no window is opened:
// FORK_AT_TERMINAL='{cmd}' runs the window's command as a hidden background
// process instead.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { Transcript, tempRoot, writeTranscript, writeLedger } = require('./helpers');

const SCRIPTS = path.join(__dirname, '..');
const FAKE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const SID = 'abcdef12-0000-4000-8000-000000000001';
const DIRECTIVE = "don't touch files & wait";

function run(script, args, env, cwd = os.tmpdir()) {
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('CLAUDE') || k.startsWith('FORK_AT') || k.startsWith('FAKE_')) delete clean[k];
  return spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
    encoding: 'utf8',
    cwd,
    env: { ...clean, NO_COLOR: '1', ...env },
  });
}

// A claude on disk that runs the fake. On Windows it is a .cmd, so the shell
// path — prompt on stdin, directive through cmd.exe — is what gets exercised;
// elsewhere it is an executable script called directly. The directory name
// has a space, so every quoting step is on the line.
function fakeClaude(root) {
  const dir = path.join(root, 'bin dir');
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    const exe = path.join(dir, 'claude.cmd');
    fs.writeFileSync(exe, `@"${process.execPath}" "${FAKE}" %*\r\n`);
    return exe;
  }
  const exe = path.join(dir, 'claude');
  fs.writeFileSync(exe, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  return exe;
}

const readJsonl = (file) =>
  fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

async function waitFor(fn, ms = 20000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('timed out waiting for the window to finish');
    await new Promise((r) => setTimeout(r, 100));
  }
}

// On Windows the temp directory can come back as an 8.3 short path from one
// API and long from another; compare what the filesystem says.
const same = (a, b) => assert.equal(fs.realpathSync.native(a).toLowerCase(), fs.realpathSync.native(b).toLowerCase());

const promptOf = (entry) => entry.stdin || entry.argv.at(-1);
const after = (argv, flag) => argv[argv.indexOf(flag) + 1];

// A parent session started in `project`, two finished turns, and the fork-at
// invocation running now.
function forkSession(t) {
  const root = tempRoot(t);
  const project = path.join(root, 'my project');
  fs.mkdirSync(project);
  const tr = new Transcript(0, project);
  tr.turn('Plan `B3`’s cache layer', 'Use an LRU.');
  tr.turn('What about eviction?', 'Evict on write.');
  tr.command('skillbox:fork-at', 'whatever');
  writeTranscript(root, SID, tr);
  const exe = fakeClaude(root);
  const log = path.join(root, 'calls.jsonl');
  return {
    root,
    project,
    exe,
    log,
    ledger: path.join(root, 'fork-tree.jsonl'),
    env: { CLAUDE_CONFIG_DIR: root, CLAUDE_CODE_SESSION_ID: SID, CLAUDE_CODE_EXECPATH: exe, FAKE_CLAUDE_LOG: log },
  };
}

const childOf = (stdout) => /^child\s+(\S+)$/m.exec(stdout)[1];
const lines = (stdout) => stdout.split('\n').filter(Boolean);

describe('fork-at.js — opening the child', () => {
  test('the parent returns at once; the window creates the fork, then resumes it with the directive', async (t) => {
    const s = forkSession(t);
    const res = run('fork-at.js', [`B3's cache -- ${DIRECTIVE}`], { ...s.env, FORK_AT_TERMINAL: '{cmd}' });
    assert.equal(res.status, 0, res.stderr);

    const [create, resume] = await waitFor(() => {
      const calls = readJsonl(s.log);
      return calls.length === 2 && calls;
    });
    const child = after(create.argv, '--session-id');

    // The parent did none of the slow work, and keeps one line of it in its
    // history: which turn, which child, where it went.
    assert.deepEqual(lines(res.stdout), [
      `forked after "Plan \`B3\`’s cache layer" (turn 1 of 2) → ${child.slice(0, 8)}, opening in FORK_AT_TERMINAL`,
    ]);

    // 1. The headless create: truncating resume of the parent, idle prompt only.
    assert.ok(create.argv.includes('-p'));
    assert.equal(after(create.argv, '--resume'), SID);
    assert.ok(create.argv.includes('--fork-session'));
    assert.ok(create.argv.includes('--resume-session-at'));
    assert.match(promptOf(create), new RegExp(`^\\[fork\\] parent=${SID} cut=\\S+\\n\\nSession forked`));
    assert.ok(!promptOf(create).includes('touch'), 'the directive never runs headless');

    // 2. The interactive resume, with the directive as the first message.
    assert.deepEqual(resume.argv, ['--resume', child, DIRECTIVE]);

    // Both ran from the parent's project directory — not the caller's — with
    // its config directory, and neither looks nested.
    for (const call of [create, resume]) {
      same(call.cwd, s.project);
      assert.equal(call.configDir, s.root);
      assert.equal(call.nested, null);
    }

    const [entry] = await waitFor(() => readJsonl(s.ledger).length === 1 && readJsonl(s.ledger));
    assert.equal(entry.parent, SID);
    assert.equal(entry.child, child);
    assert.equal(entry.directive, DIRECTIVE);
    same(entry.cwd, s.project);
    assert.deepEqual(fs.readdirSync(path.join(s.root, 'fork-pending')), [], 'the hand-off is used up');
  });

  // The window may start with a fresh environment and in the home directory.
  // Everything it needs comes from the hand-off file.
  test('the window needs nothing from its own environment or directory', (t) => {
    const s = forkSession(t);
    const child = 'cccccccc-0000-4000-8000-000000000009';
    const spec = path.join(s.root, 'fork-pending', `${child}.json`);
    fs.mkdirSync(path.dirname(spec));
    fs.writeFileSync(
      spec,
      JSON.stringify({
        version: 1,
        root: s.root,
        configDir: s.root,
        exe: s.exe,
        cwd: s.project,
        parent: SID,
        child,
        cutUuid: 'dddddddd-0000-4000-8000-000000000000',
        dropsTurnUuid: null,
        droppedTurns: 1,
        label: 'Plan the cache',
        directive: null,
      }),
    );

    const res = run('fork-at.js', ['--finish', spec], { FAKE_CLAUDE_LOG: s.log }, os.homedir());
    assert.equal(res.status, 0, res.stderr);

    const [create, resume] = readJsonl(s.log);
    assert.ok(!create.argv.includes('--resume-drops-turn'), 'no drops-turn when the cut spans more than one turn');
    assert.deepEqual(resume.argv, ['--resume', child], 'no directive, no first message');
    for (const call of [create, resume]) {
      same(call.cwd, s.project);
      assert.equal(call.configDir, s.root);
    }
    assert.equal(readJsonl(s.ledger)[0].child, child);
    assert.equal(fs.existsSync(spec), false);
  });

  test('a failed create records nothing and does not resume', (t) => {
    const s = forkSession(t);
    const res = run('fork-at.js', ['--no-open'], { ...s.env, FAKE_CLAUDE_EXIT: '3' });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Error: claude exited 3 — no fork created, nothing recorded/);
    assert.equal(readJsonl(s.log).length, 1, 'only the create was attempted');
    assert.equal(fs.existsSync(s.ledger), false);
  });

  test('--no-open creates the fork here and says the directive was not sent', (t) => {
    const s = forkSession(t);
    const res = run('fork-at.js', [`--no-open -- ${DIRECTIVE}`], s.env);
    assert.equal(res.status, 0, res.stderr);
    const calls = readJsonl(s.log);
    const child = after(calls[0].argv, '--session-id');
    // Still one line: a fork made in the parent prints no progress output.
    assert.deepEqual(lines(res.stdout), [
      `forked after "What about eviction?" (turn 2 of 2) → ${child.slice(0, 8)}, resume with: claude --resume ${child} (directive not sent — paste it in yourself)`,
    ]);
    assert.equal(calls.length, 1, 'created, not resumed');
    same(calls[0].cwd, s.project);
    assert.equal(readJsonl(s.ledger).length, 1);
  });

  test('a missing hand-off is an error, not a crash', (t) => {
    const res = run('fork-at.js', ['--finish', path.join(tempRoot(t), 'nope.json')], {});
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: cannot read the fork hand-off/);
  });

  test('an unrecognised hand-off is removed, not left for a retry', (t) => {
    const spec = path.join(tempRoot(t), 'fork-pending', 'x.json');
    fs.mkdirSync(path.dirname(spec));
    fs.writeFileSync(spec, JSON.stringify({ version: 99 }));
    const res = run('fork-at.js', ['--finish', spec], {});
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: unrecognised fork hand-off/);
    assert.equal(fs.existsSync(spec), false);
  });

  // The hand-off can outlive the directory it names.
  test('the window refuses a session directory that is gone, before creating anything', (t) => {
    const s = forkSession(t);
    const child = 'cccccccc-0000-4000-8000-000000000010';
    const spec = path.join(s.root, 'fork-pending', `${child}.json`);
    fs.mkdirSync(path.dirname(spec));
    fs.writeFileSync(
      spec,
      JSON.stringify({ version: 1, root: s.root, configDir: s.root, exe: s.exe, cwd: path.join(s.root, 'vanished'), parent: SID, child, cutUuid: 'dddddddd-0000-4000-8000-000000000000', dropsTurnUuid: null, droppedTurns: 0, label: 'x', name: 'Fork: x', directive: null }),
    );
    const res = run('fork-at.js', ['--finish', spec], { FAKE_CLAUDE_LOG: s.log }, os.homedir());
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: .*vanished no longer exists — claude --resume looks a session up/);
    assert.ok(res.stderr.includes(path.join(s.root, 'projects', 'd--proj')), 'the transcript folder is named');
    assert.equal(readJsonl(s.log).length, 0, 'nothing ran');
    assert.equal(fs.existsSync(s.ledger), false);
    assert.equal(fs.existsSync(spec), false, 'the hand-off is still used up');
  });
});

describe('fork-at.js — before the fork', () => {
  test('dry run: the plan, both commands, and a prompt without the directive', (t) => {
    const s = forkSession(t);
    const res = run('fork-at.js', [`--dry-run B3's cache -- ${DIRECTIVE}`], s.env);
    assert.equal(res.status, 0, res.stderr);
    const child = childOf(res.stdout);
    assert.match(res.stdout, /matched\s+turn 1 of 2 .*\(matched in your prompt\)/);
    assert.match(res.stdout, /directive "don't touch files & wait" — sent as your first message in the child/);
    assert.ok(res.stdout.includes(`cwd       ${s.project}`));
    assert.ok(res.stdout.includes("name      Fork: B3's cache"), 'named after the search text');
    assert.match(res.stdout, /would open a window that runs\n {2}\S.* -p --resume abcdef12-\S+ .*--name "Fork: B3's cache"/);
    assert.ok(res.stdout.includes(`--resume ${child} "don't touch files & wait"`));
    assert.match(res.stdout, /prompt\n\s+\[fork\] parent=abcdef12-\S+ cut=\S+\n\s*\n\s+Session forked/);
    assert.equal(readJsonl(s.log).length, 0, 'nothing ran');
    assert.equal(fs.existsSync(path.join(s.root, 'fork-pending')), false, 'nothing handed off');
  });

  test('no match exits 1 with the candidates on stderr', (t) => {
    const s = forkSession(t);
    const res = run('fork-at.js', ['--dry-run', 'zebra'], s.env);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: nothing matches "zebra"/);
    assert.match(res.stderr, /pick one: {3}\/skillbox:fork-at @/);
    assert.equal(res.stdout, '');
  });

  test('refuses to run outside a session', (t) => {
    const s = forkSession(t);
    const res = run('fork-at.js', ['--dry-run'], { CLAUDE_CONFIG_DIR: s.root });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /CLAUDE_CODE_SESSION_ID is not set/);
  });

  test('a session with no transcript is reported, not crashed on', (t) => {
    const s = forkSession(t);
    const res = run('fork-at.js', ['--dry-run'], { ...s.env, CLAUDE_CODE_SESSION_ID: 'ffffffff-0000-4000-8000-000000000000' });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: no transcript for session/);
  });

  test('a stale hand-off is swept on the way in; a fresh one is left for its window', (t) => {
    const s = forkSession(t);
    const dir = path.join(s.root, 'fork-pending');
    fs.mkdirSync(dir);
    const stale = path.join(dir, 'stale.json');
    fs.writeFileSync(stale, '{}');
    fs.writeFileSync(path.join(dir, 'fresh.json'), '{}');
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(stale, hourAgo, hourAgo);
    const res = run('fork-at.js', ['--dry-run'], s.env);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(fs.readdirSync(dir), ['fresh.json']);
  });

  test('a session whose directory is gone is refused before any window opens', (t) => {
    const s = forkSession(t);
    fs.rmSync(s.project, { recursive: true });
    const res = run('fork-at.js', ["B3's cache"], { ...s.env, FORK_AT_TERMINAL: '{cmd}' });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: .*my project no longer exists — claude --resume looks a session up/);
    assert.ok(res.stderr.includes(path.join(s.root, 'projects', 'd--proj')), 'the transcript folder is named');
    assert.equal(fs.existsSync(path.join(s.root, 'fork-pending')), false, 'nothing handed off');
    assert.equal(readJsonl(s.log).length, 0, 'nothing ran');

    // A dry run still shows the plan, with the directory flagged where a real
    // run stops.
    const dry = run('fork-at.js', ['--dry-run'], s.env);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /^cwd {7}.*my project {3}\(missing — a real run stops here\)$/m);
  });
});

describe('fork-tree.js', () => {
  const PARENT = 'aaaa0000-0000-4000-8000-000000000001';
  const CHILD = 'bbbb0000-0000-4000-8000-000000000002';

  function tree(t) {
    const root = tempRoot(t);
    const project = path.join(root, 'tree project');
    fs.mkdirSync(project);
    for (const [sid, title] of [[PARENT, 'Parent session'], [CHILD, 'Child session']]) {
      const tr = new Transcript(0, project);
      tr.turn('hello', 'hi');
      tr.meta({ type: 'ai-title', aiTitle: title });
      writeTranscript(root, sid, tr);
    }
    writeLedger(root, [[PARENT, CHILD]]);
    return { root, project };
  }

  test('static view from inside the child, flags passed as one quoted argument', (t) => {
    const { root } = tree(t);
    const res = run('fork-tree.js', ['--static --no-color'], { CLAUDE_CONFIG_DIR: root, CLAUDE_CODE_SESSION_ID: CHILD });
    assert.equal(res.status, 0, res.stderr);
    const lines = res.stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^\s+1\s+aaaa0000\s+Parent session\s+\[1 turn\]/);
    assert.match(lines[1], /^\s+2\s+● └─ bbbb0000\s+Child session.*\(you are here\)$/);
  });

  test('from a plain shell it lists the whole forest', (t) => {
    const { root } = tree(t);
    const res = run('fork-tree.js', ['--static'], { CLAUDE_CONFIG_DIR: root });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /aaaa0000[\s\S]*└─ bbbb0000/);
    assert.doesNotMatch(res.stdout, /you are here/);
  });

  test('--open resumes the session from its own project directory', async (t) => {
    const { root, project } = tree(t);
    const exe = fakeClaude(root);
    const log = path.join(root, 'calls.jsonl');
    const res = run(
      'fork-tree.js',
      ['--open 1'],
      { CLAUDE_CONFIG_DIR: root, CLAUDE_CODE_SESSION_ID: CHILD, CLAUDE_CODE_EXECPATH: exe, FAKE_CLAUDE_LOG: log, FORK_AT_TERMINAL: '{cmd}' },
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`opened ${PARENT} in FORK_AT_TERMINAL`));
    const [call] = await waitFor(() => readJsonl(log).length === 1 && readJsonl(log));
    assert.deepEqual(call.argv, ['--resume', PARENT]);
    same(call.cwd, project);
  });

  test('an out-of-range --open exits 1 without launching anything', (t) => {
    const { root } = tree(t);
    const res = run('fork-tree.js', ['--open 9'], { CLAUDE_CONFIG_DIR: root, CLAUDE_CODE_SESSION_ID: CHILD });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: no node numbered 9/);
  });

  test('an empty config directory has no forks', (t) => {
    const res = run('fork-tree.js', ['--static'], { CLAUDE_CONFIG_DIR: tempRoot(t) });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /no forks recorded yet/);
  });

  test('the cache forgets a deleted transcript, and stale hand-offs are swept', (t) => {
    const { root } = tree(t);
    const env = { CLAUDE_CONFIG_DIR: root, CLAUDE_CODE_SESSION_ID: CHILD };
    const stale = path.join(root, 'fork-pending', 'stale.json');
    fs.mkdirSync(path.dirname(stale));
    fs.writeFileSync(stale, '{}');
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(stale, hourAgo, hourAgo);

    assert.equal(run('fork-tree.js', ['--static'], env).status, 0);
    const keys = () => Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'fork-tree-cache.json'), 'utf8')).files);
    assert.equal(keys().length, 2, 'both transcripts cached');
    assert.equal(fs.existsSync(stale), false, 'swept');

    fs.unlinkSync(path.join(root, 'projects', 'd--proj', `${PARENT}.jsonl`));
    const res = run('fork-tree.js', ['--static'], env);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /aaaa0000\s+\(transcript not found\)/, 'the ledger still places it in the tree');
    assert.deepEqual(keys().map((f) => path.basename(f)), [`${CHILD}.jsonl`]);
  });

  test('a session whose directory is gone is tagged, and not opened', (t) => {
    const { root, project } = tree(t);
    fs.rmSync(project, { recursive: true });
    const log = path.join(root, 'calls.jsonl');
    const env = { CLAUDE_CONFIG_DIR: root, CLAUDE_CODE_SESSION_ID: CHILD, CLAUDE_CODE_EXECPATH: fakeClaude(root), FAKE_CLAUDE_LOG: log, FORK_AT_TERMINAL: '{cmd}' };

    const shown = run('fork-tree.js', ['--static'], env);
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /aaaa0000\s+Parent session.*dir missing/);

    const res = run('fork-tree.js', ['--open 1'], env);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: .*tree project no longer exists — claude --resume looks a session up/);
    assert.ok(res.stderr.includes(path.join(root, 'projects', 'd--proj')), 'the transcript folder is named');
    assert.equal(fs.existsSync(log), false, 'nothing launched');
  });
});
