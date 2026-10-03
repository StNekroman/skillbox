// The skills' copies of the doc checker match its source, and the sync tool finds and repairs
// every way they can drift.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { plan, drift, sync } = require('../sync-doc-check');

const REPO = path.resolve(__dirname, '..', '..');

function tree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillbox-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  for (const [p, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), content);
  }
  return root;
}

test('every skill copy of the doc checker matches its source', () => {
  assert.deepEqual(drift(REPO), [], 'a copy differs from plugins/skillbox/scripts/doc-check: run `npm run sync`');
  assert.ok(plan(REPO).length > 0);
});

test('drift finds a missing, a changed and a leftover copy, and sync repairs all three', (t) => {
  const opts = { source: 'src', skills: ['skills/a'] };
  const root = tree(t, {
    'src/check.js': 'new\n',
    'src/lib/model.js': 'model\n',
    'src/references/format.md': 'format\n',
    'skills/a/scripts/check.js': 'old\n',
    'skills/a/scripts/old-name.js': 'gone\n',
    'skills/a/references/own.md': 'the skill keeps this\n',
  });
  assert.deepEqual(drift(root, opts), [
    { dest: 'skills/a/scripts/check.js', problem: 'differs' },
    { dest: 'skills/a/scripts/lib/model.js', problem: 'missing' },
    { dest: 'skills/a/references/format.md', problem: 'missing' },
    { dest: 'skills/a/scripts/old-name.js', problem: 'extra' },
  ]);
  sync(root, opts);
  assert.deepEqual(drift(root, opts), []);
  assert.equal(fs.readFileSync(path.join(root, 'skills/a/scripts/check.js'), 'utf8'), 'new\n');
  assert.ok(!fs.existsSync(path.join(root, 'skills/a/scripts/old-name.js')));
  assert.ok(fs.existsSync(path.join(root, 'skills/a/references/own.md')), 'a reference the source does not have stays');
});
