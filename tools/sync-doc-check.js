#!/usr/bin/env node
// Copies the doc checker into every skill that ships it. The source lives once, in
// plugins/skillbox/scripts/doc-check/; each skill carries an identical copy so that its folder
// works installed on its own. A dev tool: it lives outside plugins/, so it never installs.
//
//   node tools/sync-doc-check.js           write the copies, delete files the source no longer has
//   node tools/sync-doc-check.js --check   list what is out of date; exit 1 if anything is
//
// What a skill gets: everything in the source but references/ goes to <skill>/scripts/, which the
// sync owns outright, so a file the source dropped is deleted there. references/<name>.md goes to
// <skill>/references/<name>.md; only those names are the sync's, and the skill's other references
// are its own.

const fs = require('fs');
const path = require('path');

const SOURCE = 'plugins/skillbox/scripts/doc-check';
const SKILLS = ['plugins/skillbox/skills/to-sdd'];
const SHARED_REFS = 'references';

const posix = (p) => p.split(path.sep).join('/');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p).map((q) => posix(path.join(e.name, q))));
    else if (e.isFile()) out.push(e.name);
  }
  return out.sort();
}

// Every copy the source makes: { from, to }, both relative to root.
function plan(root, { source = SOURCE, skills = SKILLS } = {}) {
  const out = [];
  for (const file of walk(path.join(root, source))) {
    const shared = file.startsWith(`${SHARED_REFS}/`);
    for (const skill of skills) {
      out.push({ from: `${source}/${file}`, to: shared ? `${skill}/${file}` : `${skill}/scripts/${file}` });
    }
  }
  return out;
}

// What differs from the plan: [{ dest, problem }], problem being missing, differs or extra.
function drift(root, opts = {}) {
  const { skills = SKILLS } = opts;
  const copies = plan(root, opts);
  const problems = [];
  for (const { from, to } of copies) {
    const dest = path.join(root, to);
    if (!fs.existsSync(dest)) problems.push({ dest: to, problem: 'missing' });
    else if (!fs.readFileSync(dest).equals(fs.readFileSync(path.join(root, from)))) problems.push({ dest: to, problem: 'differs' });
  }
  const planned = new Set(copies.map((c) => c.to));
  for (const skill of skills) {
    for (const file of walk(path.join(root, skill, 'scripts'))) {
      const to = `${skill}/scripts/${file}`;
      if (!planned.has(to)) problems.push({ dest: to, problem: 'extra' });
    }
  }
  return problems;
}

// Brings every copy in line with the source. Returns what it changed, as drift reported it.
function sync(root, opts = {}) {
  const problems = drift(root, opts);
  const from = new Map(plan(root, opts).map((c) => [c.to, c.from]));
  for (const { dest, problem } of problems) {
    const abs = path.join(root, dest);
    if (problem === 'extra') {
      fs.rmSync(abs);
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.copyFileSync(path.join(root, from.get(dest)), abs);
  }
  // Directories the deletions emptied.
  for (const skill of opts.skills || SKILLS) {
    const prune = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) prune(path.join(dir, e.name));
      if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
    };
    prune(path.join(root, skill, 'scripts'));
  }
  return problems;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const check = process.argv.includes('--check');
  const problems = check ? drift(root) : sync(root);
  for (const { dest, problem } of problems) console.log(`${problem === 'extra' ? (check ? 'extra' : 'deleted') : check ? problem : 'wrote'}: ${dest}`);
  if (!problems.length) console.log('Every copy matches its source.');
  else if (check) {
    console.log('\nRun `npm run sync` to bring the copies in line.');
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { SOURCE, SKILLS, plan, drift, sync };
