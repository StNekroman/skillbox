const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const T = require('../fork-tree');
const G = require('../lib/fork-graph');
const { Transcript, tempRoot, writeTranscript, withEnv } = require('./helpers');

// child -> parent pairs, in the shape collectEdges returns.
const edgesOf = (pairs) => new Map(pairs.map(([child, parent]) => [child, { parent, cut: 'x', source: 'ledger' }]));
const shape = (rows) => rows.map((r) => (r.cycle ? `${r.prefix}↑` : `${r.prefix}${r.id}`));

describe('invert and ancestorsOf', () => {
  test('inverts to parent -> children, skipping self-edges', () => {
    const kids = T.invert(edgesOf([['a', 'r'], ['b', 'r'], ['s', 's']]));
    assert.deepEqual(kids.get('r'), ['a', 'b']);
    assert.equal(kids.has('s'), false);
  });

  test('walks up to the root, root first', () => {
    assert.deepEqual(T.ancestorsOf(edgesOf([['f', 'p'], ['p', 'r']]), 'f'), ['r', 'p']);
    assert.deepEqual(T.ancestorsOf(edgesOf([]), 'f'), []);
  });

  test('a corrupt ledger with a cycle does not loop', () => {
    assert.deepEqual(T.ancestorsOf(edgesOf([['a', 'b'], ['b', 'c'], ['c', 'a']]), 'a'), ['c', 'b']);
  });
});

describe('buildRows', () => {
  // r ── p ─┬─ f ─┬─ k1
  //         │     └─ k2
  //         └─ s
  const edges = edgesOf([['p', 'r'], ['f', 'p'], ['s', 'p'], ['k1', 'f'], ['k2', 'f']]);
  const kids = T.invert(edges);

  test('focused: the ancestor spine without siblings, then the whole subtree', () => {
    assert.deepEqual(shape(T.buildRows(edges, kids, 'f', false)), [
      'r',
      '└─ p',
      '   └─ f',
      '      ├─ k1',
      '      └─ k2',
    ]);
  });

  test('--full: the whole tree from the root, siblings included', () => {
    assert.deepEqual(shape(T.buildRows(edges, kids, 'f', true)), [
      'r',
      '└─ p',
      '   ├─ f',
      '   │  ├─ k1',
      '   │  └─ k2',
      '   └─ s',
    ]);
  });

  test('a root with no forks is a single row', () => {
    assert.deepEqual(shape(T.buildRows(new Map(), new Map(), 'lone', false)), ['lone']);
  });

  test('a cycle is drawn once and marked, not followed', () => {
    const cyc = edgesOf([['f', 'x'], ['x', 'f']]);
    const rows = T.buildRows(cyc, T.invert(cyc), 'f', false);
    assert.deepEqual(shape(rows), ['x', '└─ f', '   └─ x', '      ↑']);
  });
});

describe('buildForest', () => {
  test('every root and its descendants, the busiest tree first', () => {
    const edges = edgesOf([['w', 'z'], ['x', 'r'], ['y', 'r']]);
    assert.deepEqual(shape(T.buildForest(edges, T.invert(edges))), ['r', '├─ x', '└─ y', 'z', '└─ w']);
  });

  test('no edges, no rows', () => {
    assert.deepEqual(T.buildForest(new Map(), new Map()), []);
  });
});

describe('age', () => {
  test('buckets by minute, hour and day', () => {
    const ago = (ms) => new Date(Date.now() - ms).toISOString();
    assert.equal(T.age(ago(10 * 1000)), 'just now');
    assert.equal(T.age(ago(5 * 60 * 1000)), '5m ago');
    assert.equal(T.age(ago(3 * 3600 * 1000)), '3h ago');
    assert.equal(T.age(ago(2 * 86400 * 1000)), '2d ago');
    assert.equal(T.age(null), '');
    assert.equal(T.age('not a date'), '');
    assert.equal(T.age(new Date(Date.now() + 60000).toISOString()), '');
  });
});

describe('resolveFocus', () => {
  const A = 'aaaa1111-0000-4000-8000-000000000001';
  const B = 'aaaa2222-0000-4000-8000-000000000002';

  function root(t) {
    const r = tempRoot(t);
    for (const [sid, title] of [[A, 'Cache layer design'], [B, 'Cache eviction tests']]) {
      const tr = new Transcript();
      tr.human('hi');
      tr.meta({ type: 'ai-title', aiTitle: title });
      writeTranscript(r, sid, tr);
    }
    return r;
  }

  test('by full id, unique prefix, or unique title text', (t) => {
    const r = root(t);
    const cache = G.loadCache(r);
    assert.equal(T.resolveFocus(r, cache, B), B);
    assert.equal(T.resolveFocus(r, cache, 'AAAA1'), A);
    assert.equal(T.resolveFocus(r, cache, 'eviction'), B);
  });

  test('an ambiguous prefix or title fails and lists the candidates', (t) => {
    const r = root(t);
    const cache = G.loadCache(r);
    assert.throws(() => T.resolveFocus(r, cache, 'aaaa'), (e) => e instanceof G.CliError && /matches 2 sessions/.test(e.message));
    assert.throws(
      () => T.resolveFocus(r, cache, 'cache'),
      (e) => e instanceof G.CliError && e.message.includes('aaaa1111') && e.message.includes('aaaa2222'),
    );
    assert.throws(() => T.resolveFocus(r, cache, 'zebra'), /no session matches/);
  });

  test('with no argument, the current session — or none from a plain shell', (t) => {
    const r = root(t);
    withEnv(t, { CLAUDE_CODE_SESSION_ID: A });
    assert.equal(T.resolveFocus(r, G.loadCache(r), null), A);
    delete process.env.CLAUDE_CODE_SESSION_ID;
    assert.equal(T.resolveFocus(r, G.loadCache(r), null), null);
  });
});
