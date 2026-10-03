// End to end: sdd-check.js as the to-sdd skill and the Stop hook run it, in throwaway
// repositories — git ones when git is installed, since the hook and `refs --changed` read git.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const D = require('../../skills/to-sdd/scripts/lib/sdd-doc');
const { loadConfig, loadDocs, citingFiles } = require('../../skills/to-sdd/scripts/sdd-check');
const { tempRoot, scriptEnv } = require('./helpers');
const { body, section, readme, text } = require('./sdd-helpers');

const SCRIPT = path.join(__dirname, '..', '..', 'skills', 'to-sdd', 'scripts', 'sdd-check.js');
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const needsGit = { skip: !HAS_GIT && 'git is not installed' };
const CONFIG = { version: 1, paths: { sddRoot: 'docs/sdd' }, sdd: { maxLines: 40 } };
const GIT_ID = ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];

function write(root, files) {
  for (const [p, content] of Object.entries(files)) {
    const abs = path.join(root, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Array.isArray(content) ? text(content) : content);
  }
}

const read = (root, p) => fs.readFileSync(path.join(root, p), 'utf8');

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, [...GIT_ID, 'commit', '-q', '--no-verify', '-m', message]);
}

// A repository holding the plugin config and the given files, committed when git is there.
function repo(t, files = {}, { config = CONFIG, useGit = HAS_GIT } = {}) {
  const root = tempRoot(t);
  if (config) write(root, { '.skillbox/tickets.json': JSON.stringify(config, null, 2) });
  write(root, files);
  if (useGit) {
    git(root, ['init', '-q']);
    git(root, ['config', 'core.autocrlf', 'false']);
    commit(root, 'base');
  }
  return root;
}

// A folder SDD as fix leaves it, from the text of its README.md.
function folderDoc(dir, readmeLines, maxLines = CONFIG.sdd.maxLines) {
  const id = /^SDD\d+/.exec(path.basename(dir))[0];
  const res = D.fixDoc(new Map([[D.README, readmeLines]]), { id, maxLines });
  assert.equal(res.blocked, null);
  return Object.fromEntries([...res.files].map(([name, lines]) => [`${dir}/${name}`, lines]));
}

const mailDoc = () => folderDoc('docs/sdd/SDD001-mail', readme('SDD001', 'Mail', [...section('1', 'Overview'), ...section('2', 'Delivery')]));

function run(cwd, args, input) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', input, env: scriptEnv() });
}

// The hook's reply to the given input, or null when it lets the turn end. Either way it exits 0 and
// writes nothing to stderr.
function runHook(cwd, input) {
  const r = run(cwd, ['hook'], JSON.stringify(input));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  return r.stdout ? JSON.parse(r.stdout) : null;
}

// The hook as Claude Code runs it: the reason it sends the turn back with, or null.
function hook(root, fields = {}) {
  const reply = runHook(root, { hook_event_name: 'Stop', stop_hook_active: false, cwd: root, ...fields });
  if (!reply) return null;
  assert.deepEqual(Object.keys(reply), ['decision', 'reason']);
  assert.equal(reply.decision, 'block');
  return reply.reason;
}

describe('check', () => {
  test('a repository whose SDDs and references are sound passes', (t) => {
    const root = repo(t, { ...mailDoc(), 'src/mail.ts': ['// Sends mail as SDD001§2 describes.', 'export {};'] });
    const r = run(root, ['check']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^All SDD docs pass\.$/m);
  });

  test('a broken reference fails, with its path and line', (t) => {
    const root = repo(t, { ...mailDoc(), 'src/mail.ts': ['export {};', '// SDD001§7, SDD006§2.4.1/§12'] });
    const r = run(root, ['check']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^src\/mail\.ts:2: SDD001 has no §7$/m);
    assert.match(r.stdout, /^src\/mail\.ts:2: SDD006 does not exist$/m);
    assert.match(r.stdout, /^src\/mail\.ts:2: short form: write SDD006§12, not §12 after SDD006§2\.4\.1$/m);
  });

  test('with git, the reference scan reads only files that can cite: SDD in the text, ignored files excluded', needsGit, (t) => {
    const root = repo(t, {
      ...mailDoc(),
      '.gitignore': ['build/'],
      'src/a.ts': ['// SDD001§1'],
      'src/b.ts': ['nothing to cite here'],
      'src/gone.ts': ['// SDD001§1'],
    });
    write(root, { 'build/out.js': ['// SDD404'], 'src/new.ts': ['// SDD001§9'] });
    fs.rmSync(path.join(root, 'src/gone.ts'));
    const cfg = loadConfig(root);
    assert.deepEqual(citingFiles(cfg, loadDocs(cfg)), ['docs/sdd/SDD001-mail/README.md', 'src/a.ts', 'src/new.ts']);

    const r = run(root, ['check']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^src\/new\.ts:1: SDD001 has no §9$/m);
    assert.doesNotMatch(r.stdout, /SDD404/);
  });

  test('without git, every file below the root is read, minus node_modules and dot-directories', (t) => {
    const root = repo(
      t,
      { ...mailDoc(), 'src/a.ts': ['// SDD001§9'], 'node_modules/x/index.js': ['// SDD404'], '.cache/y.md': ['SDD404'] },
      { useGit: false },
    );
    const r = run(root, ['check']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^src\/a\.ts:1: SDD001 has no §9$/m);
    assert.doesNotMatch(r.stdout, /SDD404/);
  });

  test('a scoped check reports only what concerns the SDDs named', (t) => {
    const root = repo(t, {
      ...folderDoc('docs/sdd/SDD001-mail', readme('SDD001', 'Mail', section('1', 'One'), 'x'.repeat(501))),
      ...folderDoc('docs/sdd/SDD002-rates', readme('SDD002', 'Rates', section('1', 'One'))),
      'src/a.ts': ['// SDD002§9 and SDD001§8'],
    });
    const r = run(root, ['check', 'SDD002']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /src\/a\.ts:1: SDD002 has no §9/);
    assert.doesNotMatch(r.stdout, /SDD001|abstract/);
  });

  test('a label cited where a number belongs fails, naming the headings that carry it', (t) => {
    const root = repo(t, {
      ...folderDoc('docs/sdd/SDD001-mail', readme('SDD001', 'Mail', [...section('1', 'Queue (§P1)'), ...section('2', 'Sending'), 'Since §P1 it retries.', ''])),
      'src/mail.ts': ['// SDD001§P1, SDD001 §2', 'export {};'],
    });
    const r = run(root, ['check']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^src\/mail\.ts:1: "§P1" is not a section number; the one heading in SDD001 that carries it is §1$/m);
    assert.match(r.stdout, /^src\/mail\.ts:1: short form: write SDD001§2, not §2 after SDD001$/m);
    assert.match(r.stdout, /^docs\/sdd\/SDD001-mail\/README\.md:\d+: "§P1" is not a section number; the one heading/m);
  });

  test('a source file with a NUL byte in a string is still read; a binary is not', (t) => {
    const root = repo(t, { ...mailDoc(), 'src/sep.ts': 'export const SEP = "\0";\n// SDD001§9\n', 'img/logo.png': '\0\0PNG SDD404\n' });
    const r = run(root, ['check']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^src\/sep\.ts:2: SDD001 has no §9$/m);
    assert.doesNotMatch(r.stdout, /SDD404/);
  });

  test('two SDDs with one number are a clash', (t) => {
    const root = repo(t, {
      ...folderDoc('docs/sdd/SDD003-rates', readme('SDD003', 'Rates')),
      ...folderDoc('docs/sdd/SDD003-refunds', readme('SDD003', 'Refunds')),
    });
    const r = run(root, ['check']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /two SDDs are numbered SDD003: SDD003-rates and SDD003-refunds; renumber the newer one/);
  });

  test('the limit has no default: without sdd.maxLines it stops and points at the init', (t) => {
    const root = repo(t, {}, { config: { paths: { sddRoot: 'docs/sdd' } } });
    const r = run(root, ['check']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /has no sdd\.maxLines; the to-sdd skill's init sets it/);
  });

  test('outside any configured repository it says where the config would be', (t) => {
    const r = run(tempRoot(t), ['check']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no \.skillbox\/tickets\.json in this directory or above/);
  });
});

describe('fix', () => {
  const big = () => readme('SDD001', 'Mail', [...section('1', 'Overview', body('one', 20)), ...section('2', 'Delivery', body('two', 20))]);

  test('splits an SDD over the limit, and what it writes then passes check', (t) => {
    const root = repo(t, { 'docs/sdd/SDD001-mail/README.md': big() });
    const dir = path.join(root, 'docs/sdd/SDD001-mail');

    const dry = run(root, ['fix', '--dry-run']);
    assert.equal(dry.status, 0, dry.stdout);
    assert.match(dry.stdout, /^SDD001: moved §1, §2 out of README\.md into their own files; regenerated the index\.$/m);
    assert.deepEqual(fs.readdirSync(dir), ['README.md']);

    const r = run(root, ['fix']);
    assert.equal(r.status, 0, r.stdout);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['1.md', '2.md', 'README.md']);
    assert.match(read(root, 'docs/sdd/SDD001-mail/2.md'), /^> \[SDD001 — Mail\]\(README\.md\)\n\n## §2 Delivery\n/);
    assert.equal(run(root, ['check']).status, 0);
  });

  test('merges back the section files that fit, and deletes them; a dry run deletes nothing', (t) => {
    const small = (n) => section(String(n), `Part ${n}`, body(`p${n}`, 2));
    const split = folderDoc('docs/sdd/SDD001-mail', readme('SDD001', 'Mail', [small(1), section('2', 'Big', body('big', 30)), small(3)].flat()), 10);
    const root = repo(t, split);
    const dir = path.join(root, 'docs/sdd/SDD001-mail');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['1.md', '2.md', '3.md', 'README.md']);

    const dry = run(root, ['fix', '--dry-run']);
    assert.equal(dry.status, 0, dry.stdout);
    assert.match(dry.stdout, /^SDD001: merged §1, §3 back into README\.md; regenerated the index\.$/m);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['1.md', '2.md', '3.md', 'README.md']);

    const r = run(root, ['fix']);
    assert.equal(r.status, 0, r.stdout);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['2.md', 'README.md']);
    assert.match(read(root, 'docs/sdd/SDD001-mail/README.md'), /^## §3 Part 3\n\np3 line 1\.\np3 line 2\.\n$/m);
    assert.equal(run(root, ['check']).status, 0);
  });

  test('leaves a doc with a structural problem untouched, and says what to repair first', (t) => {
    const broken = readme('SDD001', 'Mail', [...section('1', 'Overview'), ...section('2.1', 'Orphan')]);
    const root = repo(t, { 'docs/sdd/SDD001-mail/README.md': broken });
    const r = run(root, ['fix']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^SDD001: not changed\. Repair these first, then run fix again:$/m);
    assert.match(r.stdout, /README\.md:\d+: §2\.1 has no parent: there is no §2/);
    assert.equal(read(root, 'docs/sdd/SDD001-mail/README.md'), text(broken));
  });
});

describe('migrate', () => {
  test('moves single-file SDDs into folders and rewrites what pointed at them', (t) => {
    const root = repo(t, {
      'docs/sdd/SDD001-mail.md': readme('SDD001', 'Mail', [
        '---',
        '',
        '## Index',
        '',
        '- **§1 Overview**',
        '- **§2 Delivery**',
        '',
        '---',
        '',
        ...section('1', 'Overview', body('one', 20)),
        ...section('2', 'Delivery', [
          'Rates come from [SDD002](SDD002-rates.md)§1.',
          'Tables: SDD002§1 (rates), §2 (zones); §1 here.',
          ...body('two', 20),
        ]),
      ]),
      'docs/sdd/SDD002-rates.md': readme('SDD002', 'Rates', [...section('1', 'Tables'), ...section('2', 'Zones')]),
      'docs/tickets/feature-x.md': ['Implements [the mail design](../sdd/SDD001-mail.md).'],
      'src/mail.ts': ['// SDD001§1/§2 and §1 of SDD002', '// Zones: SDD002 §2.', 'export {};'],
    });

    const dry = run(root, ['migrate', '--dry-run']);
    assert.equal(dry.status, 0, dry.stdout);
    assert.match(dry.stdout, /Links to single-file SDDs turned into ids: 2\. References rewritten into the full form: 4\./);
    assert.ok(fs.existsSync(path.join(root, 'docs/sdd/SDD001-mail.md')), 'a dry run moves nothing');
    assert.equal(read(root, 'src/mail.ts'), '// SDD001§1/§2 and §1 of SDD002\n// Zones: SDD002 §2.\nexport {};\n');

    const r = run(root, ['migrate']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'docs/sdd/SDD001-mail.md')));
    assert.deepEqual(fs.readdirSync(path.join(root, 'docs/sdd/SDD001-mail')).sort(), ['1.md', '2.md', 'README.md']);
    assert.deepEqual(fs.readdirSync(path.join(root, 'docs/sdd/SDD002-rates')), ['README.md']);
    assert.equal(read(root, 'docs/tickets/feature-x.md'), 'Implements the mail design (SDD001).\n');
    assert.equal(read(root, 'src/mail.ts'), '// SDD001§1, SDD001§2 and SDD002§1\n// Zones: SDD002§2.\nexport {};\n');
    assert.match(read(root, 'docs/sdd/SDD001-mail/2.md'), /^Rates come from SDD002§1\.$/m);
    assert.match(read(root, 'docs/sdd/SDD001-mail/2.md'), /^Tables: SDD002§1 \(rates\), SDD002§2 \(zones\); §1 here\.$/m);
    const entry = read(root, 'docs/sdd/SDD001-mail/README.md');
    assert.ok(entry.includes(`${D.INDEX_OPEN}\n- [§1 Overview](1.md)\n- [§2 Delivery](2.md)\n${D.INDEX_CLOSE}`), entry);
    assert.doesNotMatch(entry, /\*\*§1 Overview\*\*/);
    assert.equal(run(root, ['check']).status, 0);
  });

  test('with nothing in the old format, there is nothing to do', (t) => {
    const r = run(repo(t, mailDoc()), ['migrate']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Nothing to migrate/);
  });
});

describe('lint', () => {
  const doc = () =>
    folderDoc(
      'docs/sdd/SDD001-mail',
      readme('SDD001', 'Mail', [
        ...section('1', 'Sending', [
          '`MailService.send()` in `src/mail/mail.service.ts` queues it; `MailService.sendLater()` used to batch.',
          '`MAIL_SENDER_KEY` and `MAIL_OLD_KEY` come from `src/config/`; see `src/gone/old.ts` and `mail.dto.ts`.',
          'The feed, `feed.xml`, is `app/feed.xml/route.ts`; `mail/mail.service.ts` is short; `src/mail.service.ts` is wrong.',
          'Built into `dist/mail.js`, with `VARCHAR(500)` columns from `ensureMailTable()`; dates by `formatMailDate()`.',
        ]),
      ]),
    );
  const code = {
    '.gitignore': ['dist/'],
    'src/mail/mail.service.ts': ['export class MailService { send() {} }', 'const k = process.env.MAIL_SENDER_KEY;'],
    'src/app/feed.xml/route.ts': ['export {};'],
    'src/mail/format.ts': 'export const formatMailDate = () => "\0";\n',
    'src/config/index.ts': ['export {};'],
    'src/migrations/001-drop.ts': ['// drops MAIL_OLD_KEY and sendLater; ensureMailTable()'],
    'docs/tickets/old.md': ['MailService.sendLater() and mail.dto.ts'],
  };

  const expected = [
    'reads as history, "used to": state what is true now',
    '`MailService.sendLater()`: sendLater is only in migrations: check whether one drops it',
    '`MAIL_OLD_KEY`: MAIL_OLD_KEY is only in migrations: check whether one drops it',
    '`src/gone/old.ts`: no such file in the repository',
    '`mail.dto.ts`: no such file in the repository',
    '`src/mail.service.ts`: no such file in the repository',
    '`ensureMailTable()`: ensureMailTable is only in migrations: check whether one drops it',
  ];
  const warnings = (stdout) =>
    stdout
      .split('\n')
      .filter((l) => l.startsWith('docs/'))
      .map((l) => l.replace(/^docs\/sdd\/SDD001-mail\/README\.md:\d+: warning: /, ''));

  test('lists history wording and the names the code no longer has, docs aside and what git ignores', needsGit, (t) => {
    const root = repo(t, { ...doc(), ...code });
    const r = run(root, ['lint']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(warnings(r.stdout), expected);
    assert.match(r.stdout, /7 warnings: leads, not verdicts/);
  });

  test('without git, the names are looked for in every file the walk finds', (t) => {
    const root = repo(t, { ...doc(), ...code }, { useGit: false });
    const r = run(root, ['lint', 'SDD001']);
    assert.equal(r.status, 0, r.stderr);
    const noGit = [...expected];
    noGit.splice(6, 0, '`dist/mail.js`: no such file in the repository');
    assert.deepEqual(warnings(r.stdout), noGit);
  });
});

describe('hook', needsGit, () => {
  test('is silent in a repository without the plugin config', (t) => {
    const root = repo(t, { 'a.md': ['x'] }, { config: null });
    assert.equal(hook(root), null);
  });

  test('is silent when the config names no SDD directory', (t) => {
    assert.equal(hook(repo(t, mailDoc(), { config: { paths: { draftRoot: 'docs/tickets' } } })), null);
  });

  test('checks only SDDs changed since HEAD, so an old problem does not stop every turn', (t) => {
    const root = repo(t, { 'docs/sdd/SDD001-mail/README.md': readme('SDD001', 'Mail', section('1', 'No index yet')) });
    write(root, { 'src/a.ts': ['export {};'] });
    assert.equal(hook(root), null);
  });

  test('a changed SDD that breaks a rule is sent back with a block decision, the manual repair first', (t) => {
    const root = repo(t, mailDoc());
    fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), text(section('4.1', 'Orphan')));
    const reason = hook(root);
    assert.match(reason, /^SDD docs changed in this task break the SDD rules\. Repair them before you finish\.$/m);
    assert.match(reason, /Repair by hand first:\n {2}docs\/sdd\/SDD001-mail\/README\.md:\d+: §4\.1 has no parent: there is no §4\n/);
    assert.match(reason, /Then run:\n {2}node ".+sdd-check\.js" fix SDD001\n/);
    assert.match(reason, /README\.md:\d+: the index is out of date/);
  });

  test('a problem fix can repair asks only for fix, and after fix the turn may end', (t) => {
    const root = repo(t, mailDoc());
    const entry = path.join(root, 'docs/sdd/SDD001-mail/README.md');
    fs.writeFileSync(entry, read(root, 'docs/sdd/SDD001-mail/README.md').replace('## §2 Delivery', '## §2 Delivery and bounces'));
    const reason = hook(root);
    assert.match(reason, /\nRun:\n {2}node ".+sdd-check\.js" fix SDD001\n/);
    assert.doesNotMatch(reason, /by hand/);

    assert.equal(run(root, ['fix', 'SDD001']).status, 0);
    assert.equal(hook(root), null);
  });

  test('once the turn has been sent back, it may end: stop_hook_active', (t) => {
    const root = repo(t, mailDoc());
    fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), text(section('4.1', 'Orphan')));
    assert.equal(hook(root, { stop_hook_active: true }), null);
  });

  test('a single-file SDD is not checked until it is migrated', (t) => {
    const root = repo(t, { 'docs/sdd/SDD001-mail.md': readme('SDD001', 'Mail', section('1', 'One')) });
    fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail.md'), text(section('4.1', 'Orphan')));
    assert.equal(hook(root), null);
  });

  test('a changed SDD with no limit configured asks for the init', (t) => {
    const root = repo(t, mailDoc(), { config: { paths: { sddRoot: 'docs/sdd' } } });
    fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), 'More text.\n');
    assert.match(hook(root), /has no valid sdd\.maxLines/);
  });

  test('finds the repository from a subdirectory, where a session may have started', (t) => {
    const root = repo(t, { ...mailDoc(), 'src/a.ts': ['export {};'] });
    fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), text(section('4.1', 'Orphan')));
    assert.ok(hook(root, { cwd: path.join(root, 'src') }));
  });

  test('a sddRoot spelled ./docs/sdd or docs\\sdd\\ still names the folders git reports', (t) => {
    for (const sddRoot of ['./docs/sdd', 'docs\\sdd\\']) {
      const root = repo(t, mailDoc(), { config: { ...CONFIG, paths: { sddRoot } } });
      fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), text(section('4.1', 'Orphan')));
      assert.ok(hook(root), sddRoot);
    }
  });

  test('sees the changes when the session runs under a symlink to the repository', (t) => {
    const root = repo(t, mailDoc());
    fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), text(section('4.1', 'Orphan')));
    const link = path.join(tempRoot(t), 'link');
    try {
      fs.symlinkSync(root, link, 'junction');
    } catch (e) {
      t.skip(`cannot make a symlink here: ${e.message}`);
      return;
    }
    assert.ok(hook(link, { cwd: link }));
  });

  test('gives Copilot CLI and Gemini CLI the same block decision, whatever they call the event', (t) => {
    const root = repo(t, mailDoc());
    fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), text(section('4.1', 'Orphan')));
    const inputs = [
      { sessionId: 's1', cwd: root, stopReason: 'end_turn', stop_hook_active: false }, // Copilot's agentStop
      { hook_event_name: 'AfterAgent', cwd: root, prompt_response: 'Done.', stop_hook_active: false }, // Gemini
    ];
    for (const input of inputs) {
      const reply = runHook(root, input);
      assert.equal(reply.decision, 'block', JSON.stringify(input));
      assert.match(reply.reason, /break the SDD rules/);
      assert.equal(runHook(root, { ...input, stop_hook_active: true }), null);
    }
  });

  test("Cursor's own stop hook: the repository from workspace_roots, the reply as a follow-up, sent once", (t) => {
    const root = repo(t, mailDoc());
    fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), text(section('4.1', 'Orphan')));
    // Run from a directory outside the repository: only workspace_roots leads to it.
    const elsewhere = tempRoot(t);
    const input = { hook_event_name: 'stop', status: 'completed', loop_count: 0, workspace_roots: [root] };
    const reply = runHook(elsewhere, input);
    assert.deepEqual(Object.keys(reply), ['followup_message']);
    assert.match(reply.followup_message, /break the SDD rules/);
    assert.equal(runHook(elsewhere, { ...input, loop_count: 1 }), null);
    assert.equal(runHook(elsewhere, { ...input, status: 'aborted' }), null);
    assert.equal(runHook(root, { ...input, workspace_roots: [] }).followup_message, reply.followup_message);
  });
});

describe('refs', needsGit, () => {
  test('--changed lists the sections changed code cites, where each lives, and who cites it', (t) => {
    const files = mailDoc();
    const root = repo(t, { ...files, 'src/mail.ts': ['export {};'], 'src/other.ts': ['// SDD001§1'] });
    write(root, { 'src/mail.ts': ['// Retries follow SDD001§2.', 'export {};'], 'src/new.ts': ['// SDD001§2 and SDD009', '// SDD1§1 too'] });
    fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), 'See SDD001§1.\n');
    const lineOf = (heading) => files['docs/sdd/SDD001-mail/README.md'].indexOf(heading) + 1;

    const r = run(root, ['refs', '--changed']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      r.stdout,
      [
        'SDD001§1  Overview',
        `  in docs/sdd/SDD001-mail/README.md:${lineOf('## §1 Overview')}`,
        '  cited by src/new.ts:2 (as SDD1§1; write SDD001§1)',
        'SDD001§2  Delivery',
        `  in docs/sdd/SDD001-mail/README.md:${lineOf('## §2 Delivery')}`,
        '  cited by src/mail.ts:1, src/new.ts:1',
        'SDD009',
        '  does not exist',
        '  cited by src/new.ts:1',
        '',
      ].join('\n'),
    );
  });

  test('--changed reads past a rename git detected in the worktree, whose old path follows it', (t) => {
    const root = repo(t, { ...mailDoc(), 'Rfile.txt': body('same', 3), 'src/b.ts': ['export {};'] });
    fs.renameSync(path.join(root, 'Rfile.txt'), path.join(root, 'src/a-renamed.txt'));
    git(root, ['add', '-N', 'src/a-renamed.txt']);
    write(root, { 'src/b.ts': ['// SDD001§2', 'export {};'] });
    assert.match(git(root, ['status', '--porcelain']), /^ R Rfile\.txt -> src\/a-renamed\.txt$/m);

    const r = run(root, ['refs', '--changed']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^ {2}cited by src\/b\.ts:1$/m);
  });

  test('with no references in the changed files, it says so', (t) => {
    const root = repo(t, { ...mailDoc(), 'src/a.ts': ['export {};'] });
    write(root, { 'src/a.ts': ['export const a = 1;'] });
    assert.match(run(root, ['refs', '--changed']).stdout, /^No SDD references in those files\.$/m);
  });
});

describe('next', () => {
  test('one more than any number ever used: folders, single files, and deleted ones in history', needsGit, (t) => {
    const root = repo(t, {
      ...mailDoc(),
      'docs/sdd/SDD003-rates.md': readme('SDD003', 'Rates'),
      'docs/sdd/SDD007-gone/README.md': readme('SDD007', 'Gone'),
    });
    fs.rmSync(path.join(root, 'docs/sdd/SDD007-gone'), { recursive: true });
    commit(root, 'drop SDD007');
    assert.equal(run(root, ['next']).stdout, 'SDD008\n');
  });

  test('an empty SDD directory starts at SDD001', (t) => {
    assert.equal(run(repo(t, {}, { useGit: false }), ['next']).stdout, 'SDD001\n');
  });
});
