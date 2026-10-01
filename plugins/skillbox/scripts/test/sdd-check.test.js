// End to end: sdd-check.js as the to-sdd skill and the Stop hook run it, in throwaway
// repositories — git ones when git is installed, since the hook and `refs --changed` read git.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const D = require('../lib/sdd-doc');
const { loadConfig, loadDocs, citingFiles } = require('../sdd-check');
const { tempRoot } = require('./helpers');
const { body, section, readme, text } = require('./sdd-helpers');

const SCRIPT = path.join(__dirname, '..', 'sdd-check.js');
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
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', input });
}

const hook = (root, fields = {}) =>
  run(root, ['hook'], JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: false, cwd: root, ...fields }));

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
        ...section('2', 'Delivery', ['Rates come from [SDD002](SDD002-rates.md)§1.', ...body('two', 20)]),
      ]),
      'docs/sdd/SDD002-rates.md': readme('SDD002', 'Rates', section('1', 'Tables')),
      'docs/tickets/feature-x.md': ['Implements [the mail design](../sdd/SDD001-mail.md).'],
      'src/mail.ts': ['// SDD001§1/§2 and §1 of SDD002', 'export {};'],
    });

    const dry = run(root, ['migrate', '--dry-run']);
    assert.equal(dry.status, 0, dry.stdout);
    assert.match(dry.stdout, /Links to single-file SDDs turned into ids: 2\. References rewritten into the full form: 2\./);
    assert.ok(fs.existsSync(path.join(root, 'docs/sdd/SDD001-mail.md')), 'a dry run moves nothing');
    assert.equal(read(root, 'src/mail.ts'), '// SDD001§1/§2 and §1 of SDD002\nexport {};\n');

    const r = run(root, ['migrate']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'docs/sdd/SDD001-mail.md')));
    assert.deepEqual(fs.readdirSync(path.join(root, 'docs/sdd/SDD001-mail')).sort(), ['1.md', '2.md', 'README.md']);
    assert.deepEqual(fs.readdirSync(path.join(root, 'docs/sdd/SDD002-rates')), ['README.md']);
    assert.equal(read(root, 'docs/tickets/feature-x.md'), 'Implements the mail design (SDD001).\n');
    assert.equal(read(root, 'src/mail.ts'), '// SDD001§1/SDD001§2 and SDD002§1\nexport {};\n');
    assert.match(read(root, 'docs/sdd/SDD001-mail/2.md'), /^Rates come from SDD002§1\.$/m);
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

describe('hook', needsGit, () => {
  test('is silent in a repository without the plugin config', (t) => {
    const root = repo(t, { 'a.md': ['x'] }, { config: null });
    const r = hook(root);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  test('is silent when the config names no SDD directory', (t) => {
    const r = hook(repo(t, mailDoc(), { config: { paths: { draftRoot: 'docs/tickets' } } }));
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  test('checks only SDDs changed since HEAD, so an old problem does not stop every turn', (t) => {
    const root = repo(t, { 'docs/sdd/SDD001-mail/README.md': readme('SDD001', 'Mail', section('1', 'No index yet')) });
    write(root, { 'src/a.ts': ['export {};'] });
    const r = hook(root);
    assert.equal(r.status, 0, r.stderr);
  });

  test('a changed SDD that breaks a rule is sent back with exit 2, the manual repair first', (t) => {
    const root = repo(t, mailDoc());
    fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), text(section('4.1', 'Orphan')));
    const r = hook(root);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^SDD docs changed in this task break the SDD rules\. Repair them before you finish\.$/m);
    assert.match(r.stderr, /Repair by hand first:\n {2}docs\/sdd\/SDD001-mail\/README\.md:\d+: §4\.1 has no parent: there is no §4\n/);
    assert.match(r.stderr, /Then run:\n {2}node ".+sdd-check\.js" fix SDD001\n/);
    assert.match(r.stderr, /README\.md:\d+: the index is out of date/);
  });

  test('a problem fix can repair asks only for fix, and after fix the turn may end', (t) => {
    const root = repo(t, mailDoc());
    const entry = path.join(root, 'docs/sdd/SDD001-mail/README.md');
    fs.writeFileSync(entry, read(root, 'docs/sdd/SDD001-mail/README.md').replace('## §2 Delivery', '## §2 Delivery and bounces'));
    const r = hook(root);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /\nRun:\n {2}node ".+sdd-check\.js" fix SDD001\n/);
    assert.doesNotMatch(r.stderr, /by hand/);

    assert.equal(run(root, ['fix', 'SDD001']).status, 0);
    assert.equal(hook(root).status, 0);
  });

  test('once the turn has been sent back, it may end: stop_hook_active', (t) => {
    const root = repo(t, mailDoc());
    fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), text(section('4.1', 'Orphan')));
    const r = hook(root, { stop_hook_active: true });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  test('a single-file SDD is not checked until it is migrated', (t) => {
    const root = repo(t, { 'docs/sdd/SDD001-mail.md': readme('SDD001', 'Mail', section('1', 'One')) });
    fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail.md'), text(section('4.1', 'Orphan')));
    assert.equal(hook(root).status, 0);
  });

  test('a changed SDD with no limit configured asks for the init', (t) => {
    const root = repo(t, mailDoc(), { config: { paths: { sddRoot: 'docs/sdd' } } });
    fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), 'More text.\n');
    const r = hook(root);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /has no valid sdd\.maxLines/);
  });

  test('finds the repository from a subdirectory, where a session may have started', (t) => {
    const root = repo(t, { ...mailDoc(), 'src/a.ts': ['export {};'] });
    fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), text(section('4.1', 'Orphan')));
    assert.equal(hook(root, { cwd: path.join(root, 'src') }).status, 2);
  });

  test('a sddRoot spelled ./docs/sdd or docs\\sdd\\ still names the folders git reports', (t) => {
    for (const sddRoot of ['./docs/sdd', 'docs\\sdd\\']) {
      const root = repo(t, mailDoc(), { config: { ...CONFIG, paths: { sddRoot } } });
      fs.appendFileSync(path.join(root, 'docs/sdd/SDD001-mail/README.md'), text(section('4.1', 'Orphan')));
      assert.equal(hook(root).status, 2, sddRoot);
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
    assert.equal(hook(link, { cwd: link }).status, 2);
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
