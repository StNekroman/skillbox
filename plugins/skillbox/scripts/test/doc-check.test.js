// End to end: doc-check.js as the skills and the Stop hook run it, in throwaway
// repositories — git ones when git is installed, since the hook and `refs --changed` read git.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const D = require('../doc-check/lib/doc-model');
const { loadConfig, loadDocs, citingFiles } = require('../doc-check/doc-check');
const { tempRoot, scriptEnv } = require('./helpers');
const { body, section, readme, text } = require('./doc-helpers');

const SCRIPT = path.join(__dirname, '..', 'doc-check', 'doc-check.js');
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

// A folder doc as fix leaves it, from the text of its README.md.
function folderDoc(dir, readmeLines, maxLines = CONFIG.sdd.maxLines) {
  const id = /^[A-Z]+\d+/.exec(path.basename(dir))[0];
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
    assert.doesNotMatch(r.stdout, /SDD001|summary/);
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
    assert.ok(entry.includes(`${D.INDEX_OPEN}\n- [§1 Overview](1.md#1-overview)\n- [§2 Delivery](2.md#2-delivery)\n${D.INDEX_CLOSE}`), entry);
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

test("the plugin's Stop hook runs this script", () => {
  const plugin = path.join(__dirname, '..', '..');
  const hooks = JSON.parse(fs.readFileSync(path.join(plugin, 'hooks', 'hooks.json'), 'utf8'));
  const [command] = hooks.hooks.Stop.flatMap((h) => h.hooks.map((x) => x.command));
  const script = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/(.+)" hook$/.exec(command);
  assert.ok(script, command);
  assert.equal(path.resolve(plugin, script[1]), SCRIPT);
});

test("the plugin's start-of-turn hook runs this script's index-hook, in the background", () => {
  const plugin = path.join(__dirname, '..', '..');
  const hooks = JSON.parse(fs.readFileSync(path.join(plugin, 'hooks', 'hooks.json'), 'utf8'));
  const [h] = hooks.hooks.UserPromptSubmit.flatMap((x) => x.hooks);
  const script = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/(.+)" index-hook$/.exec(h.command);
  assert.ok(script, h.command);
  assert.equal(path.resolve(plugin, script[1]), SCRIPT);
  assert.equal(h.async, true);
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
    assert.match(reason, /Then run:\n {2}node ".+doc-check\.js" fix SDD001\n/);
    assert.match(reason, /README\.md:\d+: the index is out of date/);
  });

  test('a problem fix can repair asks only for fix, and after fix the turn may end', (t) => {
    const root = repo(t, mailDoc());
    const entry = path.join(root, 'docs/sdd/SDD001-mail/README.md');
    fs.writeFileSync(entry, read(root, 'docs/sdd/SDD001-mail/README.md').replace('## §2 Delivery', '## §2 Delivery and bounces'));
    const reason = hook(root);
    assert.match(reason, /\nRun:\n {2}node ".+doc-check\.js" fix SDD001\n/);
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
    assert.match(run(root, ['refs', '--changed']).stdout, /^No SDD or KBDOC references in those files\.$/m);
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

describe('knowledge-base pages (KBDOC)', () => {
  const BOTH = { version: 1, paths: { sddRoot: 'docs/sdd', kbRoot: 'docs/kb' }, sdd: { maxLines: 40 }, kb: { maxLines: 40 } };
  const KB_ONLY = { version: 1, paths: { kbRoot: 'docs/kb' }, kb: { maxLines: 40 } };
  const feedDoc = (lines = []) =>
    folderDoc(
      'docs/kb/KBDOC001-merchant-center',
      readme('KBDOC001', 'Merchant Center', [...section('1', 'Contacts page rules', ['Listings are suspended without a legal entity.', ...lines]), ...section('2', 'Feed')]),
    );

  test('both types pass together, with references in every direction', (t) => {
    const root = repo(
      t,
      {
        ...folderDoc('docs/sdd/SDD001-mail', readme('SDD001', 'Mail', [...section('1', 'Overview', ['The contacts page follows KBDOC001§1.']), ...section('2', 'Delivery')])),
        ...feedDoc(['Our mail delivery, SDD001§2, sends the feed.']),
        'src/mail.ts': ['// SDD001§2, KBDOC001§1', 'export {};'],
      },
      { config: BOTH },
    );
    const r = run(root, ['check']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^All SDD docs and KB pages pass\.$/m);
  });

  test('a KBDOC reference is checked like an SDD one, and SDD001 and KBDOC001 do not clash', (t) => {
    const root = repo(t, { ...mailDoc(), ...feedDoc(), 'src/a.ts': ['// KBDOC001§9 KBDOC002 KBDOC11§1 KBDOC001 §1'] }, { config: BOTH });
    const r = run(root, ['check']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^src\/a\.ts:1: KBDOC001 has no §9$/m);
    assert.match(r.stdout, /^src\/a\.ts:1: KBDOC002 does not exist$/m);
    assert.match(r.stdout, /^src\/a\.ts:1: write KBDOC011, not KBDOC11$/m);
    assert.match(r.stdout, /^src\/a\.ts:1: short form: write KBDOC001§1, not §1 after KBDOC001$/m);
    assert.doesNotMatch(r.stdout, /numbered/);
  });

  test('two KB pages with one number are a clash, renumbered with next KBDOC', (t) => {
    const root = repo(
      t,
      {
        ...folderDoc('docs/kb/KBDOC003-feed', readme('KBDOC003', 'Feed')),
        ...folderDoc('docs/kb/KBDOC003-fees', readme('KBDOC003', 'Fees')),
      },
      { config: KB_ONLY },
    );
    const r = run(root, ['check']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /two KB pages are numbered KBDOC003: KBDOC003-feed and KBDOC003-fees; renumber the newer one with `next KBDOC`/);
  });

  test('a scoped check takes a KBDOC id; a bare number is ambiguous once both types are configured', (t) => {
    const root = repo(t, { ...mailDoc(), ...feedDoc(), 'src/a.ts': ['// SDD001§9 and KBDOC001§1'] }, { config: BOTH });
    const kb = run(root, ['check', 'kbdoc001']);
    assert.equal(kb.status, 0, kb.stdout);
    const bare = run(root, ['check', '1']);
    assert.equal(bare.status, 1);
    assert.match(bare.stderr, /ambiguous: 1; write SDD001 or KBDOC001/);
  });

  test('with only SDDs configured, a KBDOC reference is not checked, and says so in a warning', (t) => {
    const root = repo(t, { ...mailDoc(), 'src/a.ts': ['// KBDOC004§2 and KBDOC004§2/§3'] });
    const r = run(root, ['check']);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /^src\/a\.ts:1: warning: KBDOC004 is not checked: \.skillbox\/tickets\.json has no paths\.kbRoot$/m);
    assert.match(r.stdout, /^src\/a\.ts:1: short form: write KBDOC004§3, not §3 after KBDOC004§2$/m);
  });

  test('a KB-only repository passes on its own, and needs kb.maxLines', (t) => {
    const r = run(repo(t, feedDoc(), { config: KB_ONLY }), ['check']);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /^All KB pages pass\.$/m);
    const none = run(repo(t, feedDoc(), { config: { paths: { kbRoot: 'docs/kb' } } }), ['check']);
    assert.equal(none.status, 1);
    assert.match(none.stderr, /has no kb\.maxLines; the to-kb skill's init sets it/);
  });

  test('fix splits a KB page and writes its breadcrumbs; an attachments folder is left alone', (t) => {
    const big = readme('KBDOC001', 'Merchant Center', [...section('1', 'Rules', body('one', 20)), ...section('2', 'Feed', body('two', 20))]);
    const root = repo(t, { 'docs/kb/KBDOC001-merchant-center/README.md': big, 'docs/kb/attachments/notes.md': ['Not a page.'] }, { config: BOTH });
    const r = run(root, ['fix']);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /^KBDOC001: moved §1, §2 out of README\.md into their own files; regenerated the index\.$/m);
    assert.match(read(root, 'docs/kb/KBDOC001-merchant-center/2.md'), /^> \[KBDOC001 — Merchant Center\]\(README\.md\)\n\n## §2 Feed\n/);
    assert.equal(run(root, ['check']).status, 0);
  });

  test('lint on a KB page: no history, fences or identifiers; labels and missing paths are still reported', (t) => {
    const page = folderDoc(
      'docs/kb/KBDOC001-merchant-center',
      readme('KBDOC001', 'Merchant Center', [
        ...section('1', 'Feed rules (§P1)', [
          'Google used to allow it; `getWarehouses()` and `MerchantFeed.submit()` are theirs, as is `webpack.config.js`.',
          'Our side is `src/feed/feed.ts`, not `src/gone/feed.ts`.',
          '```json',
          '{ "gtin": "x" }',
          '```',
        ]),
      ]),
    );
    const root = repo(t, { ...page, 'src/feed/feed.ts': ['export {};'] }, { config: BOTH });
    const r = run(root, ['lint']);
    assert.equal(r.status, 0, r.stderr);
    const warnings = r.stdout
      .split('\n')
      .filter((l) => l.startsWith('docs/'))
      .map((l) => l.replace(/^\S+ warning: /, ''));
    assert.deepEqual(warnings, ['the title carries a label, "§P1": drop it once no reference cites the label', '`src/gone/feed.ts`: no such file in the repository']);
  });

  test('next counts each type apart, and needs the prefix once both are configured', (t) => {
    const root = repo(t, { ...mailDoc(), ...folderDoc('docs/sdd/SDD002-rates', readme('SDD002', 'Rates')), ...feedDoc() }, { config: BOTH, useGit: false });
    assert.equal(run(root, ['next', 'SDD']).stdout, 'SDD003\n');
    assert.equal(run(root, ['next', 'kbdoc']).stdout, 'KBDOC002\n');
    const bare = run(root, ['next']);
    assert.equal(bare.status, 1);
    assert.match(bare.stderr, /next needs SDD or KBDOC/);
  });

  test('both types may share one directory', (t) => {
    const config = { ...BOTH, paths: { sddRoot: 'docs', kbRoot: 'docs' } };
    const root = repo(
      t,
      {
        ...folderDoc('docs/SDD001-mail', readme('SDD001', 'Mail', section('1', 'One', ['See KBDOC001§1.']))),
        ...folderDoc('docs/KBDOC001-merchant-center', readme('KBDOC001', 'Merchant Center', section('1', 'One'))),
      },
      { config, useGit: false },
    );
    const r = run(root, ['check']);
    assert.equal(r.status, 0, r.stdout);
    assert.equal(run(root, ['next', 'KBDOC']).stdout, 'KBDOC002\n');
  });

  test('migrate expands SDD short forms and leaves KBDOC ones alone', (t) => {
    const root = repo(t, { 'docs/sdd/SDD001-mail.md': readme('SDD001', 'Mail', section('1', 'One')), ...feedDoc(), 'src/a.ts': ['// SDD001 §1 and KBDOC001 §1'] }, { config: BOTH });
    run(root, ['migrate']);
    assert.equal(read(root, 'src/a.ts'), '// SDD001§1 and KBDOC001 §1\n');
    assert.ok(fs.existsSync(path.join(root, 'docs/sdd/SDD001-mail/README.md')));
  });

  test('a doc written with the old sdd:index markers passes, and fix leaves it alone until it changes', (t) => {
    const files = mailDoc();
    const entry = 'docs/sdd/SDD001-mail/README.md';
    const old = { [D.INDEX_OPEN]: '<!-- sdd:index — generated by sdd-check from the section headings; do not edit -->', [D.INDEX_CLOSE]: '<!-- /sdd:index -->' };
    files[entry] = files[entry].map((l) => old[l] || l);
    const root = repo(t, files);
    assert.equal(run(root, ['check']).status, 0);
    const before = read(root, entry);
    assert.equal(run(root, ['fix']).status, 0);
    assert.equal(read(root, entry), before);

    fs.writeFileSync(path.join(root, entry), before.replace('## §2 Delivery', '### §2 Delivery'));
    assert.equal(run(root, ['fix']).status, 0);
    assert.ok(read(root, entry).includes(D.INDEX_OPEN));
    assert.doesNotMatch(read(root, entry), /sdd:index/);
  });

  describe('hook', needsGit, () => {
    test('a changed KB page that breaks a rule is sent back, naming the KBDOC rules', (t) => {
      const root = repo(t, feedDoc(), { config: BOTH });
      fs.appendFileSync(path.join(root, 'docs/kb/KBDOC001-merchant-center/README.md'), text(section('4.1', 'Orphan')));
      const reason = hook(root);
      assert.match(reason, /^KB pages changed in this task break the KBDOC rules\. Repair them before you finish\.$/m);
      assert.match(reason, /node ".+doc-check\.js" fix KBDOC001\n/);
    });

    test('an SDD and a KB page changed together are named together', (t) => {
      const root = repo(t, { ...mailDoc(), ...feedDoc() }, { config: BOTH });
      fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), text(section('4.1', 'Orphan')));
      fs.appendFileSync(path.join(root, 'docs/kb/KBDOC001-merchant-center/README.md'), text(section('4.1', 'Orphan')));
      const reason = hook(root);
      assert.match(reason, /^SDD docs and KB pages changed in this task break the SDD and KBDOC rules\./m);
      assert.match(reason, /fix SDD001 KBDOC001\n/);
    });

    test('a root of "." holds the docs at the top of the repository', (t) => {
      const config = { version: 1, paths: { sddRoot: '.' }, sdd: { maxLines: 40 } };
      const root = repo(t, folderDoc('SDD001-mail', readme('SDD001', 'Mail', section('1', 'One'))), { config });
      fs.appendFileSync(path.join(root, 'SDD001-mail/README.md'), text(section('4.1', 'Orphan')));
      assert.match(hook(root), /§4\.1 has no parent/);
      commit(root, 'orphan');
      fs.rmSync(path.join(root, 'SDD001-mail'), { recursive: true });
      commit(root, 'gone');
      assert.equal(run(root, ['next']).stdout, 'SDD002\n');
    });
  });
});

describe('links', () => {
  const BOTH = { version: 1, paths: { sddRoot: 'docs/sdd', kbRoot: 'docs/kb' }, sdd: { maxLines: 200 }, kb: { maxLines: 200 } };
  const lintMessages = (stdout) =>
    stdout
      .split('\n')
      .filter((l) => l.startsWith('docs/'))
      .map((l) => l.replace(/^\S+ warning: /, ''));

  test('lint reports relative links that point at nothing, in every type', (t) => {
    const sdd = folderDoc(
      'docs/sdd/SDD001-mail',
      readme('SDD001', 'Mail', [
        ...section('1', 'Sending', [
          'Kept: [mail](../../../src/mail.ts), ![logo](../../../img/logo.png), [root](/src/mail.ts), [dir](../../../src/).',
          'Gone: [old](../../../src/gone.ts), [out](../../../../outside.md), [case](../../../SRC/mail.ts).',
          'Skipped: [web](https://example.com), [top](#top), [mail](mailto:a@b.c), `[code](nope.md)`, [rates](../SDD002-rates/README.md).',
          '```text',
          '[fenced](nope.md)',
          '```',
        ]),
      ]),
      200,
    );
    const kb = folderDoc(
      'docs/kb/KBDOC001-merchant-center',
      readme('KBDOC001', 'Merchant Center', section('1', 'Spec', ['[spec](../attachments/spec.pdf) and [draft](../attachments/none.pdf).'])),
      200,
    );
    const root = repo(t, { ...sdd, ...kb, 'src/mail.ts': ['export {};'], 'img/logo.png': 'PNG', 'docs/kb/attachments/spec.pdf': 'PDF' }, { config: BOTH });
    const r = run(root, ['lint']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(lintMessages(r.stdout), [
      'the link to ../attachments/none.pdf: no docs/kb/attachments/none.pdf in the repository',
      'the link to ../../../src/gone.ts: no src/gone.ts in the repository',
      'the link to ../../../../outside.md: points outside the repository',
      'the link to ../../../SRC/mail.ts: no SRC/mail.ts in the repository',
    ]);
  });

  describe('refs', needsGit, () => {
    const page = () =>
      folderDoc(
        'docs/kb/KBDOC001-merchant-center',
        readme('KBDOC001', 'Merchant Center', [
          ...section('1', 'Feed', ['Our feed is [the feed](../../../src/feed.ts), per [the spec](../attachments/spec.pdf).']),
          ...section('2', 'Build', ['Built by `src/build/run.ts`, also written `build/run.ts`.']),
          ...section('2.1', 'Tools', ['Scripts in `tools/`.']),
          ...section('3', 'Legacy', ['Once `src/old.ts`.']),
        ]),
        200,
      );
    const code = {
      'src/feed.ts': ['export {};'],
      'src/build/run.ts': ['export {};'],
      'src/old.ts': ['export {};'],
      'tools/x.sh': ['echo'],
      'docs/kb/attachments/spec.pdf': 'PDF',
      'src/unrelated.ts': ['export {};'],
    };

    test('--changed lists the KB sections that link a changed file, by link, by path, deleted files and attachments too', (t) => {
      const files = page();
      const sdd = folderDoc('docs/sdd/SDD001-mail', readme('SDD001', 'Mail', section('1', 'One', ['Feed: [feed](../../../src/feed.ts).'])), 200);
      const root = repo(t, { ...files, ...sdd, ...code }, { config: BOTH });
      write(root, { 'src/feed.ts': ['// KBDOC001§1', 'export {};'], 'src/build/run.ts': ['export const x = 1;'], 'tools/x.sh': ['echo 2'], 'docs/kb/attachments/spec.pdf': 'PDF2' });
      fs.rmSync(path.join(root, 'src/old.ts'));
      const entry = 'docs/kb/KBDOC001-merchant-center/README.md';
      const lineOf = (text) => files[entry].findIndex((l) => l.includes(text)) + 1;

      const r = run(root, ['refs', '--changed']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          'KBDOC001§1  Feed',
          `  in ${entry}:${lineOf('## §1 Feed')}`,
          '  cited by src/feed.ts:1',
          `  links src/feed.ts (${entry}:${lineOf('Our feed')})`,
          `  links docs/kb/attachments/spec.pdf (${entry}:${lineOf('Our feed')})`,
          'KBDOC001§2  Build',
          `  in ${entry}:${lineOf('## §2 Build')}`,
          `  links src/build/run.ts (${entry}:${lineOf('Built by')})`,
          'KBDOC001§2.1  Tools',
          `  in ${entry}:${lineOf('### §2.1 Tools')}`,
          `  links tools/x.sh (${entry}:${lineOf('Scripts in')})`,
          'KBDOC001§3  Legacy',
          `  in ${entry}:${lineOf('## §3 Legacy')}`,
          `  links src/old.ts (${entry}:${lineOf('Once')})`,
          '',
        ].join('\n'),
      );
    });

    test('--changed follows a rename: a page that links the old path is reported', (t) => {
      const root = repo(t, { ...page(), ...code }, { config: BOTH });
      git(root, ['mv', 'src/old.ts', 'src/new-name.ts']);
      const r = run(root, ['refs', '--changed']);
      assert.match(r.stdout, /^KBDOC001§3 {2}Legacy\n.*\n {2}links src\/old\.ts \(/m);
    });

    test('--to lists everything that cites a section, its subsections and other spellings included', (t) => {
      const sdd = folderDoc(
        'docs/sdd/SDD001-mail',
        readme('SDD001', 'Mail', [...section('1', 'Overview', ['See §2.1.']), ...section('2', 'Delivery', ['Sends.']), ...section('2.1', 'Retries', ['Retries.'])]),
        200,
      );
      const kb = folderDoc('docs/kb/KBDOC001-merchant-center', readme('KBDOC001', 'Merchant Center', section('1', 'Feed', ['Uses SDD001§2.'])), 200);
      const root = repo(t, { ...sdd, ...kb, 'src/a.ts': ['// SDD001§2 and SDD001§2.1', '// SDD1§2', '// SDD001 and SDD001§1'] }, { config: BOTH });
      const lineOf = (files, text) => files.findIndex((l) => l.includes(text)) + 1;
      const sddLines = sdd['docs/sdd/SDD001-mail/README.md'];
      const kbLines = kb['docs/kb/KBDOC001-merchant-center/README.md'];

      const r = run(root, ['refs', '--to', 'SDD001§2']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          'SDD001§2  Delivery',
          `  in docs/sdd/SDD001-mail/README.md:${lineOf(sddLines, '## §2 Delivery')}`,
          `  cited by docs/kb/KBDOC001-merchant-center/README.md:${lineOf(kbLines, 'Uses SDD001§2')}`,
          `  cited by docs/sdd/SDD001-mail/README.md:${lineOf(sddLines, 'See §2.1')} (as §2.1)`,
          '  cited by src/a.ts:1',
          '  cited by src/a.ts:1 (§2.1)',
          '  cited by src/a.ts:2 (as SDD1§2)',
          '',
        ].join('\n'),
      );
      assert.equal(run(root, ['refs', '--to', 'SDD001:2']).stdout, r.stdout);
      assert.match(run(root, ['refs', '--to', 'SDD001']).stdout, /^ {2}cited by src\/a\.ts:3$/m);

      const none = run(root, ['refs', '--to', 'KBDOC009']);
      assert.equal(none.stdout, 'KBDOC009\n  does not exist\n  Nothing cites KBDOC009.\n');
      const bad = run(root, ['refs', '--to', 'SDD001', 'KBDOC001']);
      assert.equal(bad.status, 1);
      assert.match(bad.stderr, /refs --to takes one id/);
    });
  });
});

describe('the store index', () => {
  const INDEX = 'docs/sdd/index.generated.md';
  const withIndex = (index) => ({ ...CONFIG, sdd: { ...CONFIG.sdd, index } });
  const ratesDoc = () =>
    folderDoc('docs/sdd/SDD002-rates', readme('SDD002', 'Rates', [...section('1', 'Sources'), ...section('2', 'Caching')], 'Exchange rates. Cached for an hour.'));
  // Two SDDs, the index on with its defaults and git-ignored.
  const indexed = (t, files = {}, opts = {}) => repo(t, { ...mailDoc(), ...ratesDoc(), '.gitignore': [INDEX], ...files }, { config: withIndex({}), ...opts });
  const rewrite = (root, p, from, to) => fs.writeFileSync(path.join(root, p), read(root, p).replace(from, to));

  test('index lists every SDD, its title linking its README.md, then its summary; a second run writes nothing', (t) => {
    const root = indexed(t);
    const r = run(root, ['index']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${INDEX}: 2 SDDs, rewritten.\n`);
    const text = read(root, INDEX);
    assert.match(text, /^# SDD index\n\n<!-- Generated by doc-check .* Any SDD folder in `docs\/sdd\/` that this list lacks is newer than the list: read its README\.md\. -->\n/);
    assert.match(text, /\n- \[SDD001 — Mail\]\(SDD001-mail\/README\.md\)\n {2}What SDD001 covers, in one short paragraph\.\n/);
    assert.match(text, /\n- \[SDD002 — Rates\]\(SDD002-rates\/README\.md\)\n {2}Exchange rates\. Cached for an hour\.\n$/);
    assert.equal(run(root, ['index']).stdout, `${INDEX}: 2 SDDs, up to date.\n`);
  });

  test('summary and depth: the first sentence, and the sections down to the depth asked', (t) => {
    const root = indexed(t, {}, { config: withIndex({ summary: 'sentence', depth: 1 }) });
    run(root, ['index']);
    assert.match(read(root, INDEX), /\n- \[SDD002 — Rates\]\(SDD002-rates\/README\.md\)\n {2}Exchange rates\.\n {2}- §1 Sources\n {2}- §2 Caching\n$/);
  });

  test('the index goes where its path says, and links the docs from there', (t) => {
    const root = indexed(t, { '.gitignore': ['.skillbox/cache/'] }, { config: withIndex({ path: '.skillbox/cache/sdd.md' }) });
    assert.equal(run(root, ['index']).status, 0);
    assert.match(read(root, '.skillbox/cache/sdd.md'), /\]\(\.\.\/\.\.\/docs\/sdd\/SDD001-mail\/README\.md\)\n/);
  });

  test('two types under one path share one file, a heading each', (t) => {
    const config = { version: 1, paths: { sddRoot: 'docs', kbRoot: 'docs' }, sdd: { maxLines: 40, index: {} }, kb: { maxLines: 40, index: {} } };
    const root = repo(
      t,
      {
        ...folderDoc('docs/SDD001-mail', readme('SDD001', 'Mail', section('1', 'One'))),
        ...folderDoc('docs/KBDOC001-merchant-center', readme('KBDOC001', 'Merchant Center', section('1', 'One'))),
      },
      { config, useGit: false },
    );
    assert.equal(run(root, ['index']).stdout, 'docs/index.generated.md: 1 SDD and 1 KB page, rewritten.\n');
    const text = read(root, 'docs/index.generated.md');
    assert.match(text, /^# Doc index\n/);
    assert.match(text, /\n## SDD index\n\n- \[SDD001 — Mail\]\(SDD001-mail\/README\.md\)\n/);
    assert.match(text, /\n## Knowledge-base index\n\n- \[KBDOC001 — Merchant Center\]\(KBDOC001-merchant-center\/README\.md\)\n/);
  });

  test('without an index key there is no index, and the command points at the init', (t) => {
    const root = repo(t, mailDoc(), { useGit: false });
    const r = run(root, ['index']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /has no sdd\.index; the to-sdd skill's init sets it/);
    assert.equal(fs.existsSync(path.join(root, INDEX)), false);
  });

  test('a malformed index key is an error, in index and in check', (t) => {
    const cases = [
      [{ summary: 'all' }, /sdd\.index has summary "all"; it takes "paragraph", "sentence" or "none"/],
      [{ depth: 1.5 }, /sdd\.index has depth 1\.5/],
      [{ path: '../out.md' }, /sdd\.index has a path outside the repository/],
      [{ path: 'docs/sdd/SDD001-mail/index.md' }, /sdd\.index has a path inside a doc folder/],
      ['yes', /sdd\.index must be an object/],
    ];
    for (const [index, why] of cases) {
      const root = repo(t, mailDoc(), { config: withIndex(index), useGit: false });
      const r = run(root, ['index']);
      assert.equal(r.status, 1, JSON.stringify(index));
      assert.match(r.stderr, why);
      const c = run(root, ['check']);
      assert.equal(c.status, 1, JSON.stringify(index));
      assert.match(c.stdout, new RegExp(`^\\.skillbox/tickets\\.json: ${why.source}`, 'm'));
    }
  });

  test('fix rewrites the index once the docs no longer match it', (t) => {
    const root = indexed(t);
    run(root, ['index']);
    rewrite(root, 'docs/sdd/SDD002-rates/README.md', 'Exchange rates.', 'Currency rates.');
    const r = run(root, ['fix']);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /^docs\/sdd\/index\.generated\.md: rewritten\.$/m);
    assert.match(read(root, INDEX), /\n {2}Currency rates\./);
  });

  test('check warns about an index git would commit; the reference scans never read it', needsGit, (t) => {
    const root = indexed(t, { '.gitignore': ['build/'] });
    run(root, ['index']);
    let r = run(root, ['check']);
    assert.equal(r.status, 0, r.stdout);
    assert.deepEqual(
      r.stdout.split('\n').filter((l) => l.startsWith('docs/')),
      [`${INDEX}: warning: the index is not git-ignored; it is rebuilt from the docs, so add \`${INDEX}\` to .gitignore`],
    );
    assert.doesNotMatch(run(root, ['refs', '--to', 'SDD001']).stdout, /index\.generated/);

    commit(root, 'index');
    r = run(root, ['check']);
    assert.match(r.stdout, new RegExp(`^${INDEX}: warning: the index is committed; .*\`git rm --cached ${INDEX}\``, 'm'));

    git(root, ['rm', '-q', '--cached', INDEX]);
    write(root, { '.gitignore': [INDEX] });
    assert.match(run(root, ['check']).stdout, /^All SDD docs pass\.$/m);
  });

  test('without git, the walk finds the index and the reference scan still skips it', (t) => {
    const root = indexed(t, {}, { useGit: false });
    run(root, ['index']);
    const r = run(root, ['check']);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /^All SDD docs pass\.$/m);
  });

  describe('index-hook', () => {
    // What the hook prints. It always exits 0 and writes nothing to stderr.
    const indexHook = (cwd, input) => {
      const r = run(cwd, ['index-hook'], JSON.stringify(input));
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stderr, '');
      return r.stdout;
    };

    test('says nothing, and rewrites the index that a change since the last turn left behind', (t) => {
      const root = indexed(t);
      assert.equal(indexHook(root, { hook_event_name: 'UserPromptSubmit', cwd: root, prompt: 'hi' }), '');
      assert.match(read(root, INDEX), /Exchange rates\./);
      rewrite(root, 'docs/sdd/SDD002-rates/README.md', 'Exchange rates.', 'Currency rates.');
      const sub = path.join(root, 'docs');
      assert.equal(indexHook(sub, { hook_event_name: 'UserPromptSubmit', cwd: sub, prompt: 'hi' }), '');
      assert.match(read(root, INDEX), /Currency rates\./);
    });

    test('Copilot CLI and Gemini CLI send cwd too', (t) => {
      for (const input of [{ timestamp: 1, prompt: 'hi' }, { hook_event_name: 'BeforeAgent', prompt: 'hi' }]) {
        const root = indexed(t);
        assert.equal(indexHook(root, { ...input, cwd: root }), '');
        assert.ok(fs.existsSync(path.join(root, INDEX)), JSON.stringify(input));
      }
    });

    test("Cursor's own beforeSubmitPrompt: the repository from workspace_roots, and a reply that lets the prompt through", (t) => {
      const root = indexed(t);
      const reply = indexHook(tempRoot(t), { hook_event_name: 'beforeSubmitPrompt', workspace_roots: [root], prompt: 'hi' });
      assert.deepEqual(JSON.parse(reply), { continue: true });
      assert.ok(fs.existsSync(path.join(root, INDEX)));
    });

    test('never stops a prompt: no index key, a broken config, no repository, no input', (t) => {
      const plain = repo(t, mailDoc(), { useGit: false });
      assert.equal(indexHook(plain, { cwd: plain }), '');
      assert.equal(fs.existsSync(path.join(plain, INDEX)), false);
      const broken = repo(t, mailDoc(), { config: null, useGit: false });
      write(broken, { '.skillbox/tickets.json': '{ not json' });
      assert.equal(indexHook(broken, { cwd: broken }), '');
      const nowhere = tempRoot(t);
      assert.equal(indexHook(nowhere, { cwd: nowhere }), '');
      const r = run(nowhere, ['index-hook'], 'not json');
      assert.equal(r.status, 0);
      assert.equal(r.stdout + r.stderr, '');
    });
  });
});
