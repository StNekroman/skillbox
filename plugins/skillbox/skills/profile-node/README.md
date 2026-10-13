# profile-node

Finds where a slow Node.js path spends its time. It records a CPU profile of a running process
through its inspector port while a workload runs, and turns the profile into a markdown report an
agent can read.

`SKILL.md` is the instruction set, written for the model. This file is the human-facing summary:
what the skill does, when it fires, and what it needs.

## When it fires

When a Node.js endpoint, job or script is slow and the cause is not known, when you ask to profile
Node or find a hot path, or to check that a performance fix worked. Not for memory leaks, browser
pages, or load testing on its own.

## What it does

1. Runs a workload that repeats the slow path, and records its numbers as the baseline.
2. Finds the process's inspector port — or asks to restart the process with one.
3. Records with `scripts/profile.js`: attach, start the profiler, run the workload, stop when it
   exits. The profile goes to a `.cpuprofile` file. Beside it goes a `.meta.json` with the
   event-loop utilization and process CPU over the same window, and the workload's exit code.
4. Reads the profile with `scripts/summarize.js`.
5. Changes one thing, records again under the same conditions, and compares.

The first question the report answers is whether the path is CPU-bound at all. A request that is
slow because it waits on a database or a message broker shows a mostly idle main thread, and no CPU
profile will find that wait. Then the skill times the awaits instead of optimizing JavaScript.

## The report

Its shape, with made-up numbers:

```
# CPU profile: mail-list.cpuprofile

21.4 s recorded, 17,912 samples, 7,840 ms of them busy.
Main thread busy 36.6% of the time (event-loop utilization over the recording).
Process CPU over the recording: 9,120 ms, 42.6% of one core.

## Read this first
## Busy time by origin                       own code, each npm package, Node, V8, GC
## Hottest functions by self time            self and total share of busy time, mapped location
## How the hottest functions are reached     call paths up to the first frame of your own code,
                                             and the hot line inside each function
```

The hot line matters because V8 compiles small functions into their callers, and the profile then
counts their time as the caller's own: a callback run by a timer can show up as Node's
`listOnTimeout`, all of it on the line that calls the callback.

Locations go through source maps — inline, linked by `sourceMappingURL`, or `<file>.map` beside
the file — so a webpack bundle reports `src/messages.service.ts:88`, not `main.js:41207`. The
origin is decided on the mapped path, so a package bundled into the app is still counted as that
package. Index maps (`sections`) are not supported; their files show unmapped.

The `.cpuprofile` itself opens in Chrome DevTools (Performance panel, Load profile) or in VS Code
for a flame chart.

## The scripts

| File | What |
|---|---|
| `scripts/profile.js` | Records through the inspector port. `--port`, `--host`, `--out`, `--interval-us`, then `--seconds <n>` or `-- <workload command>` |
| `scripts/summarize.js` | Writes the markdown report. `--top`, `--paths`, `--root`, `--no-source-maps`. Also reads profiles from `node --cpu-prof` |
| `scripts/lib/inspector.js` | A minimal DevTools-protocol client: find the target, send, match answers, measure before and after |
| `scripts/lib/profile-model.js` | Pure: sample times, self and total time per function, origins, call paths |
| `scripts/lib/report.js` | Pure: the markdown |
| `scripts/lib/source-map.js` | Source-map lookup with no dependencies |

They need nothing but Node, and no install. The tests live with the plugin's other tests, in
`scripts/test/profile-node-*.test.js`.

## Limits

- **The main thread only.** Worker threads, the libuv pool (crypto, zlib, fs) and GC helper threads
  are not in the profile. The report says so when process CPU is well above the main thread's busy
  time.
- **Recording needs Node 22 or newer**, for the built-in WebSocket client. The profiled process can
  be any Node with an inspector. Summarizing works on any recent Node.
- **No shell for the workload.** On Windows, `npm`, `npx` and `nx` are `.cmd` launchers and need
  `cmd /c` in front of them.
- **One debugger at a time is safest.** If another debugger is attached and the inspector lists no
  target, detach it first.
