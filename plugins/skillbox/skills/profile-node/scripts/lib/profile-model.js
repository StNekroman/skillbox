// The CPU profile model, pure: a .cpuprofile — what the inspector's
// Profiler.stop returns and what `node --cpu-prof` writes — turned into time
// per function, per origin and per call path. Reads no file itself; source
// maps come in through the resolver it is given.

const path = require('path');

const { CliError } = require('./cli');
const { urlToPath } = require('./source-map');

// V8's pseudo-frames. They have no url; (root) only ever holds a stray sample.
const SPECIAL = new Map([
  ['(idle)', 'idle'],
  ['(garbage collector)', 'gc'],
  ['(program)', 'program'],
  ['(root)', 'program'],
]);

const ORIGIN = {
  own: 'own code',
  node: 'Node.js internals',
  native: 'V8 builtins and native',
  gc: 'garbage collector',
  program: '(program)',
  idle: '(idle)',
};

// How many callers a printed path keeps before the first own-code frame, and
// how far up the stack it looks for one.
const NEAR = 3;
const MAX_WALK = 500;

// Marks callers left out of a printed path.
const GAP = null;

function metaPathFor(profileFile) {
  return `${profileFile.replace(/\.cpuprofile$/i, '')}.meta.json`;
}

function assertProfile(profile) {
  const ok =
    profile &&
    Array.isArray(profile.nodes) &&
    Array.isArray(profile.samples) &&
    typeof profile.startTime === 'number' &&
    typeof profile.endTime === 'number';
  if (!ok) {
    throw new CliError(
      'not a V8 CPU profile (.cpuprofile): it needs nodes, samples, startTime and endTime. A Chrome Performance-panel trace is a different format.',
    );
  }
}

// Time each sample stands for, in µs. timeDeltas[i] is the gap before sample
// i, so sample i lasts until the next one — the model Chrome DevTools uses —
// and the last one until endTime. A negative gap, which V8 can emit when
// samples land out of order, counts as nothing. Without timeDeltas the
// recording is shared out evenly.
function sampleTimes(profile) {
  const { samples, timeDeltas, startTime, endTime } = profile;
  const n = samples.length;
  const out = new Float64Array(n);
  if (!Array.isArray(timeDeltas) || timeDeltas.length !== n) {
    out.fill(n ? Math.max(0, endTime - startTime) / n : 0);
    return out;
  }
  const stamps = new Float64Array(n);
  let t = startTime;
  for (let i = 0; i < n; i++) {
    t += timeDeltas[i];
    stamps[i] = t;
  }
  for (let i = 0; i < n; i++) out[i] = Math.max(0, (i + 1 < n ? stamps[i + 1] : endTime) - stamps[i]);
  return out;
}

// Whose code a frame is: an npm package by name, Node's own modules, V8's
// builtins and native code (no url), or the project's own code — everything
// else, which is what a fix can change.
function originOf(url, file) {
  if (!url || url.startsWith('wasm:')) return ORIGIN.native;
  if (url.startsWith('node:') || url.startsWith('internal/')) return ORIGIN.node;
  const p = `/${String(file).replace(/\\/g, '/')}`;
  const i = p.lastIndexOf('/node_modules/');
  if (i < 0) return ORIGIN.own;
  const [first, second] = p.slice(i + '/node_modules/'.length).split('/');
  return first.startsWith('@') && second ? `${first}/${second}` : first;
}

// A location short enough for a table: a package path from the package name
// on, a project path relative to the root, a line 1-based.
function whereOf(file, line, root) {
  if (!file) return '(native)';
  let shown = String(file).replace(/\\/g, '/');
  const nm = `/${shown}`.lastIndexOf('/node_modules/');
  if (nm >= 0) {
    shown = `/${shown}`.slice(nm + '/node_modules/'.length);
  } else if (path.isAbsolute(file)) {
    const rel = path.relative(root, file);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) shown = rel.replace(/\\/g, '/');
  }
  return line >= 0 ? `${shown}:${line + 1}` : shown;
}

// lineTicks counts the samples on each line of the function, 1-based, from the
// profile's positionTicks.
function describeFrame(callFrame, key, resolve, root) {
  const kind = (!callFrame.url && SPECIAL.get(callFrame.functionName)) || 'js';
  const name = callFrame.functionName || '(anonymous)';
  const frame = {
    key,
    kind,
    name,
    url: callFrame.url || '',
    origin: ORIGIN[kind],
    own: false,
    where: '',
    selfUs: 0,
    totalUs: 0,
    lineTicks: new Map(),
  };
  if (kind !== 'js') return frame;
  const { url, lineNumber, columnNumber } = callFrame;
  const mapped = url && lineNumber >= 0 ? resolve(url, lineNumber, Math.max(0, columnNumber)) : null;
  const file = mapped ? mapped.source : (urlToPath(url) ?? url);
  frame.origin = originOf(url, file);
  frame.own = frame.origin === ORIGIN.own;
  frame.where = whereOf(file, mapped ? mapped.line : lineNumber, root);
  return frame;
}

// The callers worth printing: the nearest three, then the first own-code
// frame above them, with a gap where frames were left out. A path that
// reaches own code sooner stops there.
function shortChain(callers) {
  const own = callers.findIndex((f) => f.own);
  if (own >= 0 && own <= NEAR) return callers.slice(0, own + 1);
  const head = callers.slice(0, NEAR);
  if (own >= 0) return [...head, GAP, callers[own]];
  return callers.length > NEAR ? [...head, GAP] : head;
}

// resolve(url, line, column) maps a generated position to its source, or
// returns null; root is what project paths are shown relative to.
function analyze(profile, { resolve = () => null, root = process.cwd() } = {}) {
  assertProfile(profile);
  const byId = new Map();
  const parent = new Map();
  for (const n of profile.nodes) byId.set(n.id, n);
  for (const n of profile.nodes) {
    if (n.parent !== undefined) parent.set(n.id, n.parent);
    for (const c of n.children || []) parent.set(c, n.id);
  }

  // The same function shows up as many nodes, one per call stack it was seen
  // on. A frame is the function; its key is what stays the same across them.
  const frames = new Map();
  const frameOfNode = new Map();
  function frameOf(id) {
    let f = frameOfNode.get(id);
    if (f) return f;
    const node = byId.get(id);
    if (!node) throw new CliError(`the profile is broken: node ${id} is referenced but missing`);
    const cf = node.callFrame || {};
    const key = [cf.functionName, cf.url, cf.lineNumber, cf.columnNumber].join('\u0000');
    f = frames.get(key);
    if (!f) {
      f = describeFrame(cf, key, resolve, root);
      frames.set(key, f);
    }
    frameOfNode.set(id, f);
    return f;
  }

  const times = sampleTimes(profile);
  const self = new Map();
  let sampledUs = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    self.set(id, (self.get(id) || 0) + times[i]);
    sampledUs += times[i];
  }

  // Total time counts a function once per sample even when it recurses.
  let idleUs = 0;
  const nodesOf = new Map();
  for (const [id, us] of self) {
    const f = frameOf(id);
    f.selfUs += us;
    for (const { line, ticks } of byId.get(id).positionTicks || []) {
      f.lineTicks.set(line, (f.lineTicks.get(line) || 0) + ticks);
    }
    if (f.kind === 'idle') idleUs += us;
    if (f.kind !== 'js') {
      f.totalUs += us;
      continue;
    }
    if (!nodesOf.has(f)) nodesOf.set(f, []);
    nodesOf.get(f).push(id);
    const seen = new Set();
    for (let a = id, depth = 0; a !== undefined && depth < 10000; a = parent.get(a), depth++) {
      const af = frameOf(a);
      if (af.kind !== 'js' || seen.has(af)) continue;
      seen.add(af);
      af.totalUs += us;
    }
  }

  const originUs = new Map();
  for (const f of frames.values()) {
    if (f.kind === 'idle' || !f.selfUs) continue;
    originUs.set(f.origin, (originUs.get(f.origin) || 0) + f.selfUs);
  }

  // The call paths a function's self time arrived on, heaviest first, at most
  // `limit` of them; the rest is summed in otherUs.
  function pathsInto(fn, limit = 3) {
    const groups = new Map();
    for (const id of nodesOf.get(fn) || []) {
      const callers = [];
      for (let a = parent.get(id), depth = 0; a !== undefined && depth < MAX_WALK; a = parent.get(a), depth++) {
        const af = frameOf(a);
        if (af.kind !== 'js') break;
        if (af === (callers.length ? callers[callers.length - 1] : fn)) continue;
        callers.push(af);
      }
      const shown = shortChain(callers);
      const key = shown.map((f) => (f ? f.key : '…')).join('\u0001');
      const g = groups.get(key) || { us: 0, frames: shown };
      g.us += self.get(id);
      groups.set(key, g);
    }
    const sorted = [...groups.values()].sort((a, b) => b.us - a.us);
    const chains = sorted.slice(0, limit);
    const otherUs = sorted.slice(limit).reduce((s, g) => s + g.us, 0);
    return { chains, otherUs };
  }

  // The line of a function that most of its own samples landed on, and that
  // line's share of them; null when the profile has no line counts. V8
  // compiles small functions into their callers, and the profile then shows
  // their time as the caller's own, on the line that calls them — so a hot
  // line is often a call.
  function hotLineOf(fn) {
    if (!fn.lineTicks.size) return null;
    let best = 0;
    let bestTicks = -1;
    let all = 0;
    for (const [line, ticks] of fn.lineTicks) {
      all += ticks;
      if (ticks > bestTicks) [best, bestTicks] = [line, ticks];
    }
    const mapped = resolve(fn.url, best - 1, -1);
    const file = mapped ? mapped.source : (urlToPath(fn.url) ?? fn.url);
    return { where: whereOf(file, mapped ? mapped.line : best - 1, root), share: bestTicks / all };
  }

  return {
    durationUs: profile.endTime - profile.startTime,
    sampledUs,
    idleUs,
    busyUs: sampledUs - idleUs,
    samples: profile.samples.length,
    gcUs: [...frames.values()].filter((f) => f.kind === 'gc').reduce((s, f) => s + f.selfUs, 0),
    origins: [...originUs].map(([origin, us]) => ({ origin, us })).sort((a, b) => b.us - a.us),
    functions: [...frames.values()].filter((f) => f.kind === 'js' && f.selfUs > 0).sort((a, b) => b.selfUs - a.selfUs),
    pathsInto,
    hotLineOf,
  };
}

module.exports = { ORIGIN, GAP, metaPathFor, sampleTimes, originOf, whereOf, shortChain, analyze };
