// The profile-node skill's pure parts: source maps, the profile model and the
// markdown report. No process is profiled here; profile-node-cli.test.js does that.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { SKILL_SCRIPTS, profileOf, encodeMappings } = require('./profile-node-helpers');
const { tempRoot } = require('./helpers');

const SM = require(path.join(SKILL_SCRIPTS, 'lib', 'source-map'));
const M = require(path.join(SKILL_SCRIPTS, 'lib', 'profile-model'));
const R = require(path.join(SKILL_SCRIPTS, 'lib', 'report'));
const { CliError } = require(path.join(SKILL_SCRIPTS, 'lib', 'cli'));

const ROOT = path.resolve(os.tmpdir(), 'proj');
const own = (file) => pathToFileURL(path.join(ROOT, file)).href;

// handle → query (@acme/db) → stringify          2000 µs
// handle → render → stringify                      1000 µs
// handle → render → render (recursion)             700 µs
// handle → render → render → listOnTimeout          300 µs
// handle itself                                     500 µs
// plus idle 5000, (program) 300, GC 200: 10 000 µs sampled, 5000 busy.
const TREE = {
  name: '(root)',
  children: [
    { name: '(program)', tag: 'program' },
    { name: '(idle)', tag: 'idle' },
    { name: '(garbage collector)', tag: 'gc' },
    {
      name: 'handle',
      url: own('src/app.js'),
      line: 9,
      col: 0,
      tag: 'handle',
      ticks: [
        [10, 1],
        [12, 4],
      ],
      children: [
        {
          name: 'query',
          url: own('node_modules/@acme/db/index.js'),
          line: 4,
          col: 2,
          children: [{ name: 'stringify', tag: 'str1' }],
        },
        {
          name: 'render',
          url: own('src/view.js'),
          line: 19,
          col: 0,
          children: [
            { name: 'stringify', tag: 'str2' },
            {
              name: 'render',
              url: own('src/view.js'),
              line: 19,
              col: 0,
              tag: 'render2',
              children: [{ name: 'listOnTimeout', url: 'node:internal/timers', line: 500, col: 0, tag: 'timers' }],
            },
          ],
        },
      ],
    },
  ],
};
const SAMPLES = [
  ['idle', 5000],
  ['program', 300],
  ['gc', 200],
  ['str1', 2000],
  ['str2', 1000],
  ['render2', 700],
  ['timers', 300],
  ['handle', 500],
];

const model = (samples = SAMPLES, opts = {}) => M.analyze(profileOf(TREE, samples), { root: ROOT, ...opts });
const fn = (m, name) => m.functions.find((f) => f.name === name);

describe('source maps', () => {
  test('mappings decode to absolute, 0-based segments, a line at a time', () => {
    // AAAA = [0,0,0,0]; CAAC = +1 col, +1 source col; gBACD = +16 col, +1 line, -1 source col.
    assert.deepEqual(SM.decodeMappings('AAAA,CAAC;;gBACD'), [[[0, 0, 0, 0], [1, 0, 0, 1]], [], [[16, 0, 1, 0]]]);
    assert.deepEqual(SM.decodeMappings('E'), [[[2]]]);
    assert.throws(() => SM.decodeMappings('A!A'), /unexpected character/);
    assert.throws(() => SM.decodeMappings('g'), /cut off/);
  });

  test('encoding and decoding agree on large and negative values', () => {
    const lines = [[[0, 0, 0, 0], [40, 1, 1200, 7]], [[3]], [[5, 0, 10, 0], [6, 1, 2, 70000]]];
    assert.deepEqual(SM.decodeMappings(encodeMappings(lines)), lines);
  });

  test('a position maps through the last segment at or before it on its own line', () => {
    const map = { sources: ['a.ts', 'b.ts'], lines: [[[0, 0, 4, 0], [10, 1, 7, 2], [20]], [[5, 0, 9, 0]]] };
    assert.deepEqual(SM.originalPosition(map, 0, 0), { source: 'a.ts', line: 4, column: 0 });
    assert.deepEqual(SM.originalPosition(map, 0, 15), { source: 'b.ts', line: 7, column: 2 });
    assert.equal(SM.originalPosition(map, 0, 25), null, 'a stretch that maps to nothing');
    assert.equal(SM.originalPosition(map, 1, 4), null, 'before the first segment of its line');
    assert.equal(SM.originalPosition(map, 2, 0), null, 'a line the map does not cover');
  });

  test('a line with no known column maps through its first mapped segment', () => {
    const map = { sources: ['a.ts'], lines: [[[0], [4, 0, 9, 2], [8, 0, 11, 0]], [[3]]] };
    assert.deepEqual(SM.originalPosition(map, 0, -1), { source: 'a.ts', line: 9, column: 2 });
    assert.equal(SM.originalPosition(map, 1, -1), null);
  });

  test('sources resolve against the map, its sourceRoot and their schemes', () => {
    const mapFile = path.join(ROOT, 'dist', 'main.js.map');
    assert.equal(SM.resolveSource('../src/a.ts', '', mapFile), path.join(ROOT, 'src', 'a.ts'));
    assert.equal(SM.resolveSource('a.ts', '../lib', mapFile), path.join(ROOT, 'lib', 'a.ts'));
    assert.equal(SM.resolveSource(pathToFileURL(path.join(ROOT, 'x.ts')).href, '', mapFile), path.join(ROOT, 'x.ts'));
    assert.equal(SM.resolveSource(path.join(ROOT, 'abs.ts'), 'ignored', mapFile), path.join(ROOT, 'abs.ts'));
    assert.equal(SM.resolveSource('webpack://mail-app/./apps/x/src/y.ts', '', mapFile), 'apps/x/src/y.ts');
    assert.equal(SM.resolveSource('external commonjs "pg"', '', mapFile), path.join(ROOT, 'dist', 'external commonjs "pg"'));
    assert.equal(SM.resolveSource('vendor:thing', '', mapFile), 'vendor:thing');
  });

  test('a map is found inline, through its comment, or beside the file; a broken one maps nothing', (t) => {
    const dir = tempRoot(t);
    const mapJson = (sources) => JSON.stringify({ version: 3, sources, mappings: encodeMappings([[[0, 0, 4, 0]]]) });
    const resolve = SM.createResolver();
    const url = (f) => pathToFileURL(path.join(dir, f)).href;

    const inline = Buffer.from(mapJson(['inline.ts'])).toString('base64');
    fs.writeFileSync(path.join(dir, 'inline.js'), `x()\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${inline}\n`);
    assert.deepEqual(resolve(url('inline.js'), 0, 3), { source: path.join(dir, 'inline.ts'), line: 4, column: 0 });

    fs.mkdirSync(path.join(dir, 'maps'));
    fs.writeFileSync(path.join(dir, 'maps', 'c.js.map'), mapJson(['../src/c.ts']));
    fs.writeFileSync(path.join(dir, 'c.js'), 'x()\n//# sourceMappingURL=maps/c.js.map\n');
    assert.equal(resolve(url('c.js'), 0, 0).source, path.join(dir, 'src', 'c.ts'));

    fs.writeFileSync(path.join(dir, 'd.js'), 'x()\n');
    fs.writeFileSync(path.join(dir, 'd.js.map'), mapJson(['d.ts']));
    assert.equal(resolve(url('d.js'), 0, 0).source, path.join(dir, 'd.ts'));

    fs.writeFileSync(path.join(dir, 'e.js'), 'x()\n//# sourceMappingURL=e.js.map\n');
    fs.writeFileSync(path.join(dir, 'e.js.map'), '{ not json');
    assert.equal(resolve(url('e.js'), 0, 0), null);

    assert.equal(resolve(url('missing.js'), 0, 0), null);
    assert.equal(resolve('node:internal/timers', 0, 0), null);
    assert.equal(resolve('', 0, 0), null);
  });

  test('each file and its map are read once', (t) => {
    const dir = tempRoot(t);
    const file = path.join(dir, 'once.js');
    fs.writeFileSync(file, 'x()\n');
    fs.writeFileSync(`${file}.map`, JSON.stringify({ version: 3, sources: ['once.ts'], mappings: 'AAIA' }));
    const resolve = SM.createResolver();
    const first = resolve(pathToFileURL(file).href, 0, 0);
    fs.rmSync(`${file}.map`);
    assert.deepEqual(resolve(pathToFileURL(file).href, 0, 0), first);
  });

  test('a profile url is a path only when it names a file', () => {
    assert.equal(SM.urlToPath(own('src/a.js')), path.join(ROOT, 'src', 'a.js'));
    assert.equal(SM.urlToPath(path.join(ROOT, 'b.js')), path.join(ROOT, 'b.js'));
    assert.equal(SM.urlToPath('node:internal/timers'), null);
    assert.equal(SM.urlToPath(''), null);
  });
});

describe('sampleTimes', () => {
  test('a sample lasts until the next one, the last one until endTime', () => {
    const p = { samples: [1, 1, 1], timeDeltas: [10, 20, 30], startTime: 0, endTime: 100 };
    assert.deepEqual([...M.sampleTimes(p)], [20, 30, 40]);
  });

  test('an out-of-order sample counts as nothing; missing deltas share the time evenly', () => {
    assert.deepEqual([...M.sampleTimes({ samples: [1, 1, 1], timeDeltas: [0, 50, -20], startTime: 0, endTime: 60 })], [50, 0, 30]);
    assert.deepEqual([...M.sampleTimes({ samples: [1, 1], startTime: 0, endTime: 10 })], [5, 5]);
  });
});

describe('origins and locations', () => {
  test('a frame belongs to its package, to Node, to V8, or to the project', () => {
    const nm = (rest) => path.join(ROOT, 'node_modules', ...rest.split('/'));
    assert.equal(M.originOf('x', nm('pg/lib/client.js')), 'pg');
    assert.equal(M.originOf('x', nm('@nestjs/core/router/x.js')), '@nestjs/core');
    assert.equal(M.originOf('x', nm('a/node_modules/b/i.js')), 'b', 'the innermost package');
    assert.equal(M.originOf('x', nm('.pnpm/c@1.0.0/node_modules/c/i.js')), 'c');
    assert.equal(M.originOf('x', 'node_modules/d/i.js'), 'd', 'a relative source from a map');
    assert.equal(M.originOf('node:internal/timers', 'node:internal/timers'), M.ORIGIN.node);
    assert.equal(M.originOf('internal/timers.js', 'internal/timers.js'), M.ORIGIN.node);
    assert.equal(M.originOf('', ''), M.ORIGIN.native);
    assert.equal(M.originOf('wasm://wasm/abc', 'wasm://wasm/abc'), M.ORIGIN.native);
    assert.equal(M.originOf('x', path.join(ROOT, 'src', 'a.ts')), M.ORIGIN.own);
  });

  test('a location is short: a package path from its name, a project path from the root', () => {
    assert.equal(M.whereOf(path.join(ROOT, 'node_modules', 'pg', 'lib', 'c.js'), 9, ROOT), 'pg/lib/c.js:10');
    assert.equal(M.whereOf(path.join(ROOT, 'src', 'a.ts'), 0, ROOT), 'src/a.ts:1');
    const outside = path.resolve(ROOT, '..', 'elsewhere.js');
    assert.equal(M.whereOf(outside, 4, ROOT), `${outside.replace(/\\/g, '/')}:5`);
    assert.equal(M.whereOf('node:internal/timers', -1, ROOT), 'node:internal/timers');
    assert.equal(M.whereOf('', -1, ROOT), '(native)');
  });

  test('the meta file sits beside the profile', () => {
    assert.equal(M.metaPathFor(path.join('d', 'x.cpuprofile')), path.join('d', 'x.meta.json'));
    assert.equal(M.metaPathFor('x.json'), 'x.json.meta.json');
  });
});

describe('analyze', () => {
  test('busy, idle and GC time come from the pseudo-frames', () => {
    const m = model();
    assert.equal(m.sampledUs, 10000);
    assert.equal(m.idleUs, 5000);
    assert.equal(m.busyUs, 5000);
    assert.equal(m.gcUs, 200);
    assert.equal(m.samples, 8);
    assert.equal(m.durationUs, 10000);
  });

  test('self time adds up across every stack a function was seen on', () => {
    const m = model();
    assert.deepEqual(
      m.functions.map((f) => [f.name, f.selfUs]),
      [
        ['stringify', 3000],
        ['render', 700],
        ['handle', 500],
        ['listOnTimeout', 300],
      ],
    );
  });

  test('total time counts a recursive function once per sample', () => {
    const m = model();
    assert.equal(fn(m, 'render').totalUs, 2000);
    assert.equal(fn(m, 'handle').totalUs, 4500);
    assert.equal(fn(m, 'stringify').totalUs, 3000);
  });

  test('busy time by origin, idle left out', () => {
    assert.deepEqual(
      model().origins.map((o) => [o.origin, o.us]),
      [
        [M.ORIGIN.native, 3000],
        [M.ORIGIN.own, 1200],
        [M.ORIGIN.program, 300],
        [M.ORIGIN.node, 300],
        [M.ORIGIN.gc, 200],
      ],
    );
  });

  test('call paths stop at the first own-code caller, recursion collapsed', () => {
    const m = model();
    const names = (p) => p.chains.map((c) => [c.us, c.frames.map((f) => f.name)]);
    assert.deepEqual(names(m.pathsInto(fn(m, 'stringify'))), [
      [2000, ['query', 'handle']],
      [1000, ['render']],
    ]);
    assert.deepEqual(names(m.pathsInto(fn(m, 'listOnTimeout'))), [[300, ['render']]]);
    assert.deepEqual(names(m.pathsInto(fn(m, 'render'))), [[700, ['handle']]]);
    assert.deepEqual(names(m.pathsInto(fn(m, 'handle'))), [[500, []]]);
  });

  test('the hot line is where most of a function’s own samples landed, mapped like the function', () => {
    const m = model();
    assert.deepEqual(m.hotLineOf(fn(m, 'handle')), { where: 'src/app.js:12', share: 0.8 });
    assert.equal(m.hotLineOf(fn(m, 'render')), null, 'no line counts in the profile');

    const resolve = (url, line, column) => (column < 0 ? { source: path.join(ROOT, 'src', 'app.ts'), line: line + 100, column: 0 } : null);
    const mapped = model(SAMPLES, { resolve });
    assert.equal(mapped.hotLineOf(fn(mapped, 'handle')).where, 'src/app.ts:112');
  });

  test('paths past the limit are summed', () => {
    const m = model();
    const p = m.pathsInto(fn(m, 'stringify'), 1);
    assert.equal(p.chains.length, 1);
    assert.equal(p.otherUs, 1000);
  });

  test('a long path keeps the nearest callers and the first own-code frame, with a gap', () => {
    const f = (name, isOwn = false) => ({ name, own: isOwn, key: name });
    const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map((n) => f(n));
    const mine = f('mine', true);
    assert.deepEqual(M.shortChain([a, b, c, mine]), [a, b, c, mine]);
    assert.deepEqual(M.shortChain([a, b, c, d, e, mine]), [a, b, c, M.GAP, mine]);
    assert.deepEqual(M.shortChain([a, b, c, d]), [a, b, c, M.GAP]);
    assert.deepEqual(M.shortChain([a, b]), [a, b]);
  });

  test('source maps decide both the location and the origin', () => {
    const tree = {
      name: '(root)',
      children: [
        { name: 'bundled', url: own('dist/main.js'), line: 0, col: 10, tag: 'b' },
        { name: 'mine', url: own('dist/main.js'), line: 3, col: 0, tag: 'm' },
        { name: 'unmapped', url: own('dist/main.js'), line: 7, col: 0, tag: 'u' },
      ],
    };
    const resolve = (url, line) =>
      line === 0
        ? { source: path.join(ROOT, 'node_modules', 'lib', 'x.ts'), line: 41, column: 0 }
        : line === 3
          ? { source: path.join(ROOT, 'src', 'a.ts'), line: 4, column: 0 }
          : null;
    const m = M.analyze(profileOf(tree, [['b', 10], ['m', 10], ['u', 10]]), { root: ROOT, resolve });
    assert.deepEqual(
      ['bundled', 'mine', 'unmapped'].map((n) => [fn(m, n).origin, fn(m, n).where]),
      [
        ['lib', 'lib/x.ts:42'],
        [M.ORIGIN.own, 'src/a.ts:5'],
        [M.ORIGIN.own, 'dist/main.js:8'],
      ],
    );
  });

  test('something that is not a CPU profile is refused, naming what it lacks', () => {
    assert.throws(() => M.analyze({ traceEvents: [] }), (e) => e instanceof CliError && /not a V8 CPU profile/.test(e.message));
    const broken = profileOf(TREE, SAMPLES);
    broken.samples[0] = 999;
    assert.throws(() => M.analyze(broken), (e) => e instanceof CliError && /node 999/.test(e.message));
  });
});

describe('report', () => {
  const META = {
    wallMs: 10,
    elu: { utilization: 0.4, activeMs: 4, idleMs: 6 },
    cpuMs: { user: 500, system: 100 },
    command: ['node', 'bench.js', '--label', 'a b'],
    exitCode: 2,
  };

  test('the header takes busy share from the recorder when it measured it', () => {
    const md = R.render(model(), { meta: META, title: 'x.cpuprofile' });
    assert.match(md, /^# CPU profile: x\.cpuprofile$/m);
    assert.match(md, /^0\.0 s recorded, 8 samples, 5\.0 ms of them busy\.$/m);
    assert.match(md, /Main thread busy 40\.0% of the time \(event-loop utilization over the recording\)/);
    assert.match(md, /Process CPU over the recording: 600 ms, 6000\.0% of one core\./);
    assert.match(md, /Workload: `node bench\.js --label "a b"`, exit code 2\./);
  });

  test('without the recorder, busy share comes from idle samples, or is not claimed at all', () => {
    assert.match(R.render(model()), /Main thread busy 50\.0% of the time \(from the profile's idle samples\)/);
    const noIdle = model(SAMPLES.filter(([tag]) => tag !== 'idle'));
    const md = R.render(noIdle);
    assert.match(md, /no idle samples/);
    assert.equal(R.busyShare(noIdle, null), null);
    assert.doesNotMatch(md, /busy only/);
  });

  test('the leads say what changes how the tables read', () => {
    const md = R.render(model(), { meta: META });
    const leads = md.split('## Read this first')[1].split('## Busy time')[0];
    assert.match(leads, /exited with code 2/);
    assert.match(leads, /Only 8 samples/);
    assert.match(leads, /busy only 40\.0%/);
    assert.match(leads, /other threads/);
    assert.doesNotMatch(leads, /Garbage collection/);
  });

  test('a main thread busy far longer than the CPU it used was blocked, not computing', () => {
    const blocked = { wallMs: 2000, elu: { utilization: 0.5, activeMs: 1000, idleMs: 1000 }, cpuMs: { user: 100, system: 20 } };
    const found = R.leads(model(), blocked).join('\n');
    assert.match(found, /busy 1,000 ms, but the process used only 120 ms of CPU: the thread was blocked/);
    assert.doesNotMatch(found, /other threads/);
    const even = { ...blocked, cpuMs: { user: 900, system: 0 } };
    assert.doesNotMatch(R.leads(model(), even).join('\n'), /blocked|other threads/);
  });

  test('heavy GC is a lead; a quiet profile has no leads section', () => {
    const gcHeavy = SAMPLES.map(([tag, us]) => [tag, tag === 'gc' ? 2000 : us]);
    assert.match(R.leads(model(gcHeavy), null).join('\n'), /Garbage collection takes 29\.4% of busy time/);
    const many = Array.from({ length: 1200 }, () => ['handle', 100]);
    assert.doesNotMatch(R.render(model(many)), /Read this first/);
  });

  test('tables: origins and functions with self and total share of busy time', () => {
    const md = R.render(model());
    assert.match(md, /^\| V8 builtins and native \| 3\.0 \| 60\.0% \|$/m);
    assert.match(md, /^\| own code \| 1\.2 \| 24\.0% \|$/m);
    assert.match(md, /^\| 1 \| 3\.0 \| 60\.0% \| 60\.0% \| `stringify` \| V8 builtins and native \| \(native\) \|$/m);
    assert.match(md, /^\| 3 \| 0\.5 \| 10\.0% \| 90\.0% \| `handle` \| own code \| src\/app\.js:10 \|$/m);
  });

  test('paths print own-code frames in bold, and the rest of the time as other paths', () => {
    const md = R.render(model());
    assert.match(md, /^### 1\. `stringify` — 3\.0 ms self, \(native\)$/m);
    assert.match(md, /^- 2\.0 ms ← `query` @acme\/db\/index\.js:5 ← \*\*`handle`\*\* src\/app\.js:10$/m);
    assert.match(md, /^- 1\.0 ms ← \*\*`render`\*\* src\/view\.js:20$/m);
    assert.match(md, /^- 0\.5 ms ← \(called from the event loop\)$/m);
    assert.match(md, /^### 3\. `handle` — 0\.5 ms self, src\/app\.js:10\n\nHot line: src\/app\.js:12, 80\.0% of its own samples\.\n\n- /m);
  });

  test('--top and --paths limit the tables', () => {
    const md = R.render(model(), { top: 2, paths: 1 });
    assert.match(md, /^\| 2 \| /m);
    assert.doesNotMatch(md, /^\| 3 \| /m);
    assert.match(md, /^### 1\. /m);
    assert.doesNotMatch(md, /^### 2\. /m);
  });
});
