// A minimal Chrome DevTools Protocol client for a Node inspector port: find
// the target on /json/list, open its WebSocket, send commands and match the
// answers. Node 22 or newer, for the built-in WebSocket and fetch.

const { CliError } = require('./cli');

// What the recorder measures in the target before and after the profile: the
// process, its event-loop utilization and its CPU time, all cumulative.
const PROBE = `JSON.stringify({
  pid: process.pid,
  node: process.version,
  elu: typeof performance === 'object' && performance.eventLoopUtilization ? performance.eventLoopUtilization() : null,
  cpu: process.cpuUsage(),
})`;

function reason(e) {
  return (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || String(e);
}

function assertRuntime() {
  if (typeof WebSocket !== 'function' || typeof fetch !== 'function') {
    throw new CliError(`recording needs Node 22 or newer, for its built-in WebSocket; this is ${process.version}.`);
  }
}

// The first of the hosts whose inspector answers, and its target. Several
// hosts because `--inspect=localhost:<port>` binds IPv4 or IPv6 depending on
// the system.
async function findTarget(hosts, port) {
  assertRuntime();
  const failures = [];
  for (const host of hosts) {
    let list;
    try {
      const res = await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
      list = await res.json();
    } catch (e) {
      failures.push(`${host}:${port} (${reason(e)})`);
      continue;
    }
    const target = Array.isArray(list) && list.find((t) => t && t.webSocketDebuggerUrl);
    if (!target) {
      throw new CliError(`${host}:${port} answers, but lists no target to attach to. Is another debugger attached to it?`);
    }
    return { host, target };
  }
  throw new CliError(
    `no Node inspector answers at ${failures.join(' or ')}. Start the process with --inspect=${port}, or pass the port it listens on.`,
  );
}

class Inspector {
  static open(url, timeoutMs = 5000) {
    assertRuntime();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => {
        ws.close();
        reject(new CliError(`the inspector at ${url} did not accept a connection within ${timeoutMs / 1000} s.`));
      }, timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new Inspector(ws));
      });
      ws.addEventListener('error', (e) => {
        clearTimeout(timer);
        reject(new CliError(`cannot connect to the inspector at ${url}: ${(e && e.message) || 'connection failed'}.`));
      });
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.closed = null;
    ws.addEventListener('message', (e) => this.receive(e.data));
    ws.addEventListener('close', () =>
      this.fail(new CliError('the inspector closed the connection. Did the process exit or restart?')),
    );
  }

  receive(data) {
    const msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
    const p = msg.id !== undefined && this.pending.get(msg.id);
    if (!p) return; // an event, or an answer that already timed out
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new CliError(`${p.method} failed: ${msg.error.message}`));
    else p.resolve(msg.result);
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(this.closed);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CliError(`${method} got no answer within ${timeoutMs / 1000} s.`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // The probe's reading, or null when the target cannot answer it — the
  // profile is still worth having without one.
  async probe() {
    try {
      const r = await this.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
      return r.exceptionDetails ? null : JSON.parse(r.result.value);
    } catch (e) {
      if (this.closed) throw e;
      return null;
    }
  }

  fail(err) {
    if (this.closed) return;
    this.closed = err;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  close() {
    this.fail(new CliError('the connection was closed.'));
    try {
      this.ws.close();
    } catch {
      // already closing
    }
  }
}

// Event-loop utilization and CPU between two probes, in ms, or what of it the
// probes could give.
function between(before, after, wallMs) {
  const out = { wallMs };
  if (!before || !after) return out;
  out.target = { pid: after.pid, node: after.node };
  if (before.elu && after.elu) {
    const activeMs = after.elu.active - before.elu.active;
    const idleMs = after.elu.idle - before.elu.idle;
    if (activeMs + idleMs > 0) out.elu = { utilization: activeMs / (activeMs + idleMs), activeMs, idleMs };
  }
  if (before.cpu && after.cpu) {
    out.cpuMs = { user: (after.cpu.user - before.cpu.user) / 1000, system: (after.cpu.system - before.cpu.system) / 1000 };
  }
  return out;
}

module.exports = { PROBE, findTarget, Inspector, between };
