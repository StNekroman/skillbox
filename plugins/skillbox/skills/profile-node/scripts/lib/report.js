// Renders the analysed profile as markdown, pure: the header, the leads that
// change how the tables should be read, busy time by origin, the hottest
// functions, and the call paths into them.

const { GAP } = require('./profile-model');

const MIN_SAMPLES = 1000;
const WAITING_BELOW = 0.5;
const GC_ABOVE = 0.1;

const ms = (us) => us / 1000;

function fmtMs(us) {
  const v = ms(us);
  return v >= 10 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
}

const pct = (part, whole) => (whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : '—');

const cell = (s) => String(s).replace(/\|/g, '\\|');

// For display only: an argument quoted when a shell would split or expand it.
const word = (s) => (/^[\w@%+=:,./\\-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`);

// The main thread's busy share over the recording: event-loop utilization
// when the recorder measured it, else the profile's own idle samples. Null
// when neither can say — a profile with no idle samples cannot tell busy from
// waiting.
function busyShare(model, meta) {
  if (meta && meta.elu && typeof meta.elu.utilization === 'number') return meta.elu.utilization;
  return model.idleUs > 0 && model.sampledUs > 0 ? model.busyUs / model.sampledUs : null;
}

function header(model, meta, title) {
  const out = [`# CPU profile: ${title}`, ''];
  out.push(
    `${(model.durationUs / 1e6).toFixed(1)} s recorded, ${model.samples.toLocaleString('en-US')} samples, ${fmtMs(model.busyUs)} ms of them busy.`,
  );
  const share = busyShare(model, meta);
  if (meta && meta.elu && typeof meta.elu.utilization === 'number') {
    out.push(`Main thread busy ${pct(share, 1)} of the time (event-loop utilization over the recording).`);
  } else if (share !== null) {
    out.push(`Main thread busy ${pct(share, 1)} of the time (from the profile's idle samples).`);
  } else {
    out.push(
      'The profile has no idle samples: either the main thread never waited, or the profiler did not mark idle time, so busy and waiting cannot be told apart here.',
    );
  }
  if (meta && meta.cpuMs && meta.wallMs > 0) {
    const cpu = meta.cpuMs.user + meta.cpuMs.system;
    out.push(`Process CPU over the recording: ${fmtMs(cpu * 1000)} ms, ${pct(cpu, meta.wallMs)} of one core.`);
  }
  if (meta && Array.isArray(meta.command) && meta.command.length) {
    out.push(`Workload: \`${meta.command.map(word).join(' ')}\`, exit code ${meta.exitCode}.`);
  }
  return out;
}

function leads(model, meta) {
  const out = [];
  if (meta && typeof meta.exitCode === 'number' && meta.exitCode !== 0) {
    out.push(`The workload exited with code ${meta.exitCode}. Check its output before trusting this profile.`);
  }
  if (model.samples < MIN_SAMPLES) {
    out.push(`Only ${model.samples} samples. The numbers are rough; profile a longer run.`);
  }
  const share = busyShare(model, meta);
  if (share !== null && share < WAITING_BELOW) {
    out.push(
      `The main thread was busy only ${pct(share, 1)} of the recording. Most of the wall time went to waiting — database, network, message broker, timers — which a CPU profile does not show. The tables below explain only the busy part; to find the wait, time the awaits on the slow path.`,
    );
  }
  if (model.busyUs > 0 && model.gcUs / model.busyUs > GC_ABOVE) {
    out.push(
      `Garbage collection takes ${pct(model.gcUs, model.busyUs)} of busy time. That is allocation pressure: look for large arrays, strings and JSON built in the hot paths below.`,
    );
  }
  if (meta && meta.cpuMs) {
    const cpu = meta.cpuMs.user + meta.cpuMs.system;
    const main = meta.elu && typeof meta.elu.activeMs === 'number' ? meta.elu.activeMs : ms(model.busyUs);
    if (cpu > 1.5 * main && cpu - main > 200) {
      out.push(
        `The process used ${fmtMs(cpu * 1000)} ms of CPU, but its main thread was busy only ${fmtMs(main * 1000)} ms. The rest ran on other threads — GC helpers, the libuv pool (crypto, zlib, fs), or worker threads — which this profile does not cover.`,
      );
    } else if (cpu < 0.5 * main && main - cpu > 200) {
      out.push(
        `The main thread was busy ${fmtMs(main * 1000)} ms, but the process used only ${fmtMs(cpu * 1000)} ms of CPU: the thread was blocked, not computing. Either it made synchronous I/O calls (\`fs.*Sync\`, \`child_process.*Sync\`, \`Atomics.wait\`) — the samples then sit on the code that made them — or the machine was short of CPU, and the numbers are inflated until you record on a quieter machine or at lower concurrency.`,
      );
    }
  }
  return out;
}

function frameText(f) {
  if (f === GAP) return '…';
  const name = `\`${cell(f.name)}\``;
  return `${f.own ? `**${name}**` : name} ${f.where}`;
}

// options: meta (the recorder's sidecar, or null), top (rows in the function
// table), paths (functions whose call paths are shown), title.
function render(model, { meta = null, top = 25, paths = 8, title = 'profile' } = {}) {
  const out = header(model, meta, title);

  const found = leads(model, meta);
  if (found.length) out.push('', '## Read this first', '', ...found.map((l) => `- ${l}`));

  out.push('', '## Busy time by origin', '', '| Origin | Self ms | % of busy |', '|---|--:|--:|');
  for (const o of model.origins) out.push(`| ${cell(o.origin)} | ${fmtMs(o.us)} | ${pct(o.us, model.busyUs)} |`);

  const fns = model.functions.slice(0, top);
  out.push(
    '',
    '## Hottest functions by self time',
    '',
    'Self time is the function’s own work; total time adds what it called.',
    '',
    '| # | Self ms | Self % | Total % | Function | Origin | Where |',
    '|--:|--:|--:|--:|---|---|---|',
  );
  fns.forEach((f, i) => {
    out.push(
      `| ${i + 1} | ${fmtMs(f.selfUs)} | ${pct(f.selfUs, model.busyUs)} | ${pct(f.totalUs, model.busyUs)} | \`${cell(f.name)}\` | ${cell(f.origin)} | ${cell(f.where)} |`,
    );
  });

  const traced = fns.slice(0, paths);
  if (traced.length) {
    out.push(
      '',
      '## How the hottest functions are reached',
      '',
      'Each line is one call path, nearest caller first, up to the first frame of your own code, in bold. The time is the function’s self time on that path. The hot line is where most of that self time landed: V8 compiles small functions into their callers, so it is often a call.',
    );
    traced.forEach((f, i) => {
      out.push('', `### ${i + 1}. \`${f.name}\` — ${fmtMs(f.selfUs)} ms self, ${f.where}`, '');
      const hot = model.hotLineOf(f);
      if (hot) out.push(`Hot line: ${hot.where}, ${pct(hot.share, 1)} of its own samples.`, '');
      const { chains, otherUs } = model.pathsInto(f);
      for (const c of chains) {
        const via = c.frames.length ? c.frames.map(frameText).join(' ← ') : '(called from the event loop)';
        out.push(`- ${fmtMs(c.us)} ms ← ${via}`);
      }
      if (otherUs > 0) out.push(`- ${fmtMs(otherUs)} ms on other paths`);
    });
  }

  out.push(
    '',
    'For a flame chart, open the .cpuprofile in Chrome DevTools (Performance panel, Load profile) or in VS Code.',
    '',
  );
  return out.join('\n');
}

module.exports = { busyShare, leads, render };
