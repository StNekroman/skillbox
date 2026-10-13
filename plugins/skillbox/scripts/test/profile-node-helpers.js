// Fixtures for the profile-node skill's tests: synthetic CPU profiles and
// source maps, built from what a test means rather than written out by hand.

const path = require('path');
const { spawn } = require('child_process');

const SKILL_SCRIPTS = path.join(__dirname, '..', '..', 'skills', 'profile-node', 'scripts');

// A .cpuprofile from a call tree and samples. A tree node is
// { name, url, line, col, tag, ticks, children }; line and col are 0-based and
// default to -1, as V8 writes them for native code; ticks is
// [[line, count], ...] with 1-based lines, V8's positionTicks. A sample is
// [tag, µs]: the node it landed on, and how long it stands for.
function profileOf(tree, samples, { startTime = 1000000 } = {}) {
  const nodes = [];
  const idOf = new Map();
  (function walk(n) {
    const node = {
      id: nodes.length + 1,
      callFrame: {
        functionName: n.name ?? '',
        scriptId: '0',
        url: n.url ?? '',
        lineNumber: n.line ?? -1,
        columnNumber: n.col ?? -1,
      },
      hitCount: 0,
      children: [],
    };
    if (n.ticks) node.positionTicks = n.ticks.map(([line, ticks]) => ({ line, ticks }));
    nodes.push(node);
    if (n.tag) idOf.set(n.tag, node.id);
    for (const c of n.children || []) node.children.push(walk(c));
    return node.id;
  })(tree);
  const ids = samples.map(([tag]) => {
    if (!idOf.has(tag)) throw new Error(`no node tagged ${tag}`);
    return idOf.get(tag);
  });
  // Sample i lasts until sample i + 1, so its length is the gap before the next.
  const timeDeltas = samples.map((_, i) => (i === 0 ? 0 : samples[i - 1][1]));
  const total = samples.reduce((s, [, us]) => s + us, 0);
  return { nodes, startTime, endTime: startTime + total, samples: ids, timeDeltas };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(n) {
  let v = n < 0 ? -n * 2 + 1 : n * 2;
  let out = '';
  do {
    let digit = v % 32;
    v = Math.floor(v / 32);
    if (v) digit += 32;
    out += B64[digit];
  } while (v);
  return out;
}

// A mappings string from absolute segments, one array per generated line;
// a segment is [column] or [column, source, line, sourceColumn].
function encodeMappings(lines) {
  let src = 0;
  let srcLine = 0;
  let srcCol = 0;
  return lines
    .map((segs) => {
      let col = 0;
      return segs
        .map((s) => {
          let out = vlq(s[0] - col);
          col = s[0];
          if (s.length >= 4) {
            out += vlq(s[1] - src) + vlq(s[2] - srcLine) + vlq(s[3] - srcCol);
            [, src, srcLine, srcCol] = s;
          }
          return out;
        })
        .join(',');
    })
    .join(';');
}

// Runs one of the skill's scripts with this Node; resolves when it exits,
// without blocking the test's own event loop.
function runScript(script, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SKILL_SCRIPTS, script), ...args], {
      ...opts,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

// A Node process with its inspector on a free port of `host`, running `code`
// with `flags`; killed when the test ends.
function startTarget(t, code, { host = '127.0.0.1', flags = [] } = {}) {
  const child = spawn(process.execPath, [`--inspect=${host}:0`, ...flags, '-e', code], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  t.after(() => child.kill());
  return new Promise((resolve, reject) => {
    let err = '';
    child.stderr.on('data', (d) => {
      err += d;
      const m = /ws:\/\/(?:\[[^\]]+\]|[^:/]+):(\d+)\//.exec(err);
      if (m) resolve({ child, port: Number(m[1]) });
    });
    child.on('exit', () => reject(new Error(`the target exited before listening: ${err}`)));
  });
}

module.exports = { SKILL_SCRIPTS, profileOf, encodeMappings, runScript, startTarget };
