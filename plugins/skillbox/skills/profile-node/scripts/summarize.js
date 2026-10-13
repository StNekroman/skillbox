#!/usr/bin/env node
// Turns a .cpuprofile into a markdown report an agent can read: how busy the
// main thread was, where the busy time went by origin, the hottest functions
// and the call paths into them, mapped through source maps where the build
// has them. Reads the recorder's .meta.json beside the profile when there is
// one; a profile from `node --cpu-prof` works without.
// Usage: node <skill>/scripts/summarize.js <file.cpuprofile> [--top 25] [--paths 8]
//          [--root <dir>] [--no-source-maps]
//        --root is what project paths are shown relative to; default the current directory.

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');

const { CliError, runMain } = require('./lib/cli');
const { analyze, metaPathFor } = require('./lib/profile-model');
const { render } = require('./lib/report');
const { createResolver } = require('./lib/source-map');

const USAGE = 'usage: summarize.js <file.cpuprofile> [--top 25] [--paths 8] [--root <dir>] [--no-source-maps]';

function count(value, fallback, flag) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new CliError(`${flag} must be a whole number.`);
  return n;
}

function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        top: { type: 'string' },
        paths: { type: 'string' },
        root: { type: 'string' },
        'no-source-maps': { type: 'boolean' },
      },
    });
  } catch (e) {
    throw new CliError(`${e.message}\n${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) throw new CliError(USAGE);
  return {
    file: path.resolve(positionals[0]),
    top: count(values.top, 25, '--top'),
    paths: count(values.paths, 8, '--paths'),
    root: path.resolve(values.root || '.'),
    sourceMaps: !values['no-source-maps'],
  };
}

function readMeta(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`summarize: ignoring ${file}: ${e.message}`);
    return null;
  }
}

function main(argv = process.argv.slice(2)) {
  const opts = parseCli(argv);
  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
  } catch (e) {
    throw new CliError(`cannot read ${opts.file}: ${e.message}`);
  }
  const model = analyze(profile, {
    resolve: opts.sourceMaps ? createResolver() : undefined,
    root: opts.root,
  });
  const meta = readMeta(metaPathFor(opts.file));
  process.stdout.write(render(model, { meta, top: opts.top, paths: opts.paths, title: path.basename(opts.file) }));
}

if (require.main === module) runMain(main);

module.exports = { parseCli, main };
