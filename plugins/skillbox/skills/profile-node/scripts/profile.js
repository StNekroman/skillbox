#!/usr/bin/env node
// Records a CPU profile of a running Node process through its inspector port,
// while a workload command runs or for a fixed time, and writes it as a
// .cpuprofile. Beside it goes a .meta.json: the event-loop utilization and
// process CPU over the same window, and the workload with its exit code.
// Usage: node <skill>/scripts/profile.js --port <n> [--host <host>] [--out <file>]
//          [--interval-us 1000] (--seconds <n> | -- <command> [args...])
//        Without --host it tries 127.0.0.1, then [::1].
//        The command is spawned without a shell; `node` runs as this same Node.
//        Needs Node 22 or newer. The profiled process can be any Node with an inspector.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parseArgs } = require('util');

const { CliError, runMain } = require('./lib/cli');
const { findTarget, Inspector, between } = require('./lib/inspector');
const { metaPathFor } = require('./lib/profile-model');

const USAGE =
  'usage: profile.js --port <n> [--host <host>] [--out <file>] [--interval-us 1000] (--seconds <n> | -- <command> [args...])';

const log = (line) => console.error(`profile: ${line}`);

function defaultOut() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(os.tmpdir(), 'profile-node', `cpu-${stamp}.cpuprofile`);
}

// Everything after the first `--` is the workload, untouched.
function parseCli(argv) {
  const dash = argv.indexOf('--');
  const head = dash < 0 ? argv : argv.slice(0, dash);
  const command = dash < 0 ? [] : argv.slice(dash + 1);
  let values;
  try {
    ({ values } = parseArgs({
      args: head,
      options: {
        port: { type: 'string' },
        host: { type: 'string' },
        out: { type: 'string' },
        'interval-us': { type: 'string' },
        seconds: { type: 'string' },
      },
    }));
  } catch (e) {
    throw new CliError(`${e.message}\n${USAGE}`);
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError(`--port must be the inspector's port.\n${USAGE}`);
  }
  const intervalUs = values['interval-us'] === undefined ? 1000 : Number(values['interval-us']);
  if (!Number.isInteger(intervalUs) || intervalUs < 50) {
    throw new CliError('--interval-us must be a whole number of microseconds, 50 or more.');
  }
  const seconds = values.seconds === undefined ? null : Number(values.seconds);
  if (seconds !== null && !(seconds > 0)) throw new CliError('--seconds must be a positive number.');
  if ((seconds === null) === (command.length === 0)) {
    throw new CliError(`give either --seconds or a workload command after --, not both and not neither.\n${USAGE}`);
  }
  return {
    hosts: values.host ? [values.host] : ['127.0.0.1', '[::1]'],
    port,
    out: path.resolve(values.out || defaultOut()),
    intervalUs,
    seconds,
    command,
  };
}

// Ctrl+C ends the wait early; the profile is still saved.
function waitSeconds(seconds) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      process.off('SIGINT', done);
      resolve();
    };
    const timer = setTimeout(done, seconds * 1000);
    process.on('SIGINT', done);
  });
}

// The workload shares the terminal. Ctrl+C reaches it too; the recorder
// ignores it and saves the profile once the workload has exited.
function runWorkload(command) {
  const [cmd, ...args] = command;
  const exe = cmd === 'node' ? process.execPath : cmd;
  return new Promise((resolve, reject) => {
    const ignore = () => {};
    process.on('SIGINT', ignore);
    const child = spawn(exe, args, { stdio: 'inherit' });
    child.on('error', (e) => {
      process.off('SIGINT', ignore);
      const hint =
        process.platform === 'win32' ? ' On Windows a .cmd launcher such as npm, npx or nx needs `cmd /c` in front of it.' : '';
      reject(new CliError(`the workload \`${cmd}\` did not start (${e.code || e.message}).${hint}`));
    });
    child.on('exit', (code, signal) => {
      process.off('SIGINT', ignore);
      resolve({ exitCode: code ?? 1, signal: signal || null });
    });
  });
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseCli(argv);
  const { host, target } = await findTarget(opts.hosts, opts.port);
  const session = await Inspector.open(target.webSocketDebuggerUrl);
  let profile;
  let before;
  let after;
  let wallMs;
  let run = { exitCode: null, signal: null };
  try {
    await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: opts.intervalUs });
    before = await session.probe();
    const who = before ? `pid ${before.pid} (Node ${before.node.replace(/^v/, '')})` : target.title || target.url || 'the target';
    await session.send('Profiler.start');
    const t0 = performance.now();
    log(`profiling ${who} at ${host}:${opts.port}, one sample every ${opts.intervalUs} µs.`);
    if (opts.seconds) await waitSeconds(opts.seconds);
    else run = await runWorkload(opts.command);
    ({ profile } = await session.send('Profiler.stop', {}, 120000));
    wallMs = performance.now() - t0;
    after = await session.probe();
    await session.send('Profiler.disable').catch(() => {});
  } finally {
    session.close();
  }

  const measured = between(before, after, wallMs);
  const meta = {
    version: 1,
    recordedAt: new Date().toISOString(),
    endpoint: `${host}:${opts.port}`,
    intervalUs: opts.intervalUs,
    ...measured,
    command: opts.command.length ? opts.command : null,
    seconds: opts.seconds,
    exitCode: run.exitCode,
    signal: run.signal,
  };
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify(profile));
  fs.writeFileSync(metaPathFor(opts.out), `${JSON.stringify(meta, null, 2)}\n`);

  const parts = [`${(wallMs / 1000).toFixed(1)} s`, `${profile.samples.length.toLocaleString('en-US')} samples`];
  if (measured.elu) parts.push(`main thread busy ${(100 * measured.elu.utilization).toFixed(0)}%`);
  if (measured.cpuMs) {
    const cpu = measured.cpuMs.user + measured.cpuMs.system;
    parts.push(`process CPU ${((100 * cpu) / wallMs).toFixed(0)}% of one core`);
  }
  log(`saved ${opts.out} (${parts.join(', ')}).`);
  log(`next: node "${path.join(__dirname, 'summarize.js')}" "${opts.out}"`);
  if (run.exitCode) {
    log(`the workload exited with code ${run.exitCode}. Check its output before trusting this profile.`);
    process.exitCode = 1;
  }
}

if (require.main === module) runMain(main);

module.exports = { parseCli, main };
