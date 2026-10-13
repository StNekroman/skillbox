// End to end: the profile-node skill's two scripts as the skill runs them.
// summarize.js reads synthetic profiles; profile.js records real Node
// processes started here with their inspector on a free port.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const path = require('path');

const { profileOf, runScript, startTarget } = require('./profile-node-helpers');
const { tempRoot } = require('./helpers');

const needsWebSocket = { skip: typeof WebSocket !== 'function' && 'recording needs Node 22 or newer' };

// About 80% busy, all of it in burnCpu. Left to itself, V8 compiles burnCpu
// into the timer code that calls it, and the profile then shows its time as
// Node's listOnTimeout; never optimizing it keeps it a frame of its own.
const BUSY_TARGET = `
function burnCpu() { const t = Date.now(); let s = 0; while (Date.now() - t < 20) s += Math.sqrt(Math.random()); return s; }
%NeverOptimizeFunction(burnCpu);
setInterval(burnCpu, 25);
`;
const BUSY_FLAGS = ['--allow-natives-syntax'];

const SLEEP = (ms) => ['node', '-e', `setTimeout(() => {}, ${ms})`];

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

describe('summarize.js', () => {
  const TREE = {
    name: '(root)',
    children: [
      { name: '(idle)', tag: 'idle' },
      { name: 'work', url: 'file:///proj/src/work.js', line: 2, col: 0, tag: 'work' },
    ],
  };

  test('prints the report for a profile, with the meta beside it', async (t) => {
    const dir = tempRoot(t);
    const file = path.join(dir, 'run.cpuprofile');
    fs.writeFileSync(file, JSON.stringify(profileOf(TREE, [['idle', 300], ['work', 700]])));
    fs.writeFileSync(path.join(dir, 'run.meta.json'), JSON.stringify({ wallMs: 1, elu: { utilization: 0.7, activeMs: 0.7, idleMs: 0.3 } }));
    const r = await runScript('summarize.js', [file]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^# CPU profile: run\.cpuprofile$/m);
    assert.match(r.stdout, /Main thread busy 70\.0% of the time \(event-loop utilization/);
    assert.match(r.stdout, /`work`/);
  });

  test('a file that is not a profile, or is not there, is an error, not a crash', async (t) => {
    const dir = tempRoot(t);
    const trace = path.join(dir, 'trace.json');
    fs.writeFileSync(trace, JSON.stringify({ traceEvents: [] }));
    const notProfile = await runScript('summarize.js', [trace]);
    assert.equal(notProfile.status, 1);
    assert.match(notProfile.stderr, /^Error: not a V8 CPU profile/);

    const missing = await runScript('summarize.js', [path.join(dir, 'nope.cpuprofile')]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /^Error: cannot read/);
  });

  test('usage errors name the usage', async () => {
    for (const args of [[], ['a', 'b'], ['x.cpuprofile', '--top', 'many'], ['--bogus']]) {
      const r = await runScript('summarize.js', args);
      assert.equal(r.status, 1, args.join(' '));
      assert.match(r.stderr, /^Error: /);
    }
  });
});

describe('profile.js', () => {
  test('refuses a run with no workload, or with two', async () => {
    const neither = await runScript('profile.js', ['--port', '9229']);
    assert.equal(neither.status, 1);
    assert.match(neither.stderr, /either --seconds or a workload command/);
    const both = await runScript('profile.js', ['--port', '9229', '--seconds', '1', '--', 'node', '-v']);
    assert.equal(both.status, 1);
    assert.match(both.stderr, /either --seconds or a workload command/);
    const noPort = await runScript('profile.js', ['--seconds', '1']);
    assert.equal(noPort.status, 1);
    assert.match(noPort.stderr, /--port must be the inspector's port/);
  });

  test('says so when nothing listens on the port', needsWebSocket, async () => {
    const port = await freePort();
    const r = await runScript('profile.js', ['--port', String(port), '--seconds', '1']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`no Node inspector answers at 127\\.0\\.0\\.1:${port}`));
  });

  test('records while the workload runs, and the report finds the busy function', needsWebSocket, async (t) => {
    const { child, port } = await startTarget(t, BUSY_TARGET, { flags: BUSY_FLAGS });
    const dir = tempRoot(t);
    const out = path.join(dir, 'busy.cpuprofile');
    const r = await runScript('profile.js', ['--port', String(port), '--out', out, '--', ...SLEEP(1200)]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, new RegExp(`profiling pid ${child.pid} `));
    assert.match(r.stderr, /saved .*busy\.cpuprofile/);

    const profile = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(profile.samples.length > 100, `${profile.samples.length} samples`);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'busy.meta.json'), 'utf8'));
    assert.equal(meta.target.pid, child.pid);
    assert.equal(meta.exitCode, 0);
    assert.deepEqual(meta.command, SLEEP(1200));
    assert.ok(meta.elu.utilization > 0.3 && meta.elu.utilization <= 1, `utilization ${meta.elu.utilization}`);
    assert.ok(meta.wallMs >= 1000, `wallMs ${meta.wallMs}`);

    const report = await runScript('summarize.js', [out]);
    assert.equal(report.status, 0, report.stderr);
    assert.match(report.stdout, /^\| 1 \| .* `burnCpu` \| own code \|/m);
  });

  test('without --host, an inspector bound to IPv6 loopback only is still found', needsWebSocket, async (t) => {
    let target;
    try {
      target = await startTarget(t, BUSY_TARGET, { host: '[::1]', flags: BUSY_FLAGS });
    } catch (e) {
      t.skip(`this system cannot listen on [::1]: ${e.message}`);
      return;
    }
    const dir = tempRoot(t);
    const out = path.join(dir, 'v6.cpuprofile');
    const r = await runScript('profile.js', ['--port', String(target.port), '--out', out, '--seconds', '0.3']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, new RegExp(`at \\[::1\\]:${target.port},`));
  });

  test('records for a fixed time when the load comes from elsewhere', needsWebSocket, async (t) => {
    const { port } = await startTarget(t, BUSY_TARGET, { flags: BUSY_FLAGS });
    const dir = tempRoot(t);
    const out = path.join(dir, 'timed.cpuprofile');
    const r = await runScript('profile.js', ['--port', String(port), '--out', out, '--seconds', '0.5']);
    assert.equal(r.status, 0, r.stderr);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'timed.meta.json'), 'utf8'));
    assert.equal(meta.seconds, 0.5);
    assert.equal(meta.command, null);
  });

  test('a failing workload still leaves its profile, and the run fails', needsWebSocket, async (t) => {
    const { port } = await startTarget(t, BUSY_TARGET, { flags: BUSY_FLAGS });
    const dir = tempRoot(t);
    const out = path.join(dir, 'failed.cpuprofile');
    const r = await runScript('profile.js', ['--port', String(port), '--out', out, '--', 'node', '-e', 'process.exit(3)']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /exited with code 3/);
    assert.ok(fs.existsSync(out));
    const report = await runScript('summarize.js', [out]);
    assert.match(report.stdout, /The workload exited with code 3/);
  });

  test('a workload that does not start stops the profiler, so the next run works', needsWebSocket, async (t) => {
    const { port } = await startTarget(t, BUSY_TARGET, { flags: BUSY_FLAGS });
    const dir = tempRoot(t);
    const out = path.join(dir, 'never.cpuprofile');
    const bad = await runScript('profile.js', ['--port', String(port), '--out', out, '--', 'no-such-command-xyz']);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /the workload `no-such-command-xyz` did not start/);
    assert.ok(!fs.existsSync(out));

    const again = await runScript('profile.js', ['--port', String(port), '--out', out, '--seconds', '0.3']);
    assert.equal(again.status, 0, again.stderr);
    assert.ok(fs.existsSync(out));
  });
});
