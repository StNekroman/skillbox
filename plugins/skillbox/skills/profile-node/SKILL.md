---
name: profile-node
description: Find where a slow Node.js code path spends its time. Records a CPU profile of a running Node process through its inspector port while a workload runs, decides first whether the path is slow on CPU at all or slow waiting on I/O, then reads where the busy time goes — by origin, by function, and the call paths into the hottest functions, mapped back to source. Use when a Node.js endpoint, job or script is slow and the cause is not known, when asked to profile Node or find a hot path, or to check that a performance fix worked; do not use for memory leaks, browser pages, or load testing alone.
metadata:
  prompt-version: "2026-10-13.1"
---

# Profile a slow Node.js path

Find where a slow path spends its time by measuring it, then fix what the measurement shows. Never name a hot path from reading code alone: code that looks expensive is often cheap, and the real cost is often somewhere nobody looked.

Two scripts do the work, and need only Node 22 or newer:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/profile.js" --port <inspector port> --out <file>.cpuprofile -- <workload command>
node "${CLAUDE_SKILL_DIR}/scripts/summarize.js" <file>.cpuprofile
```

`${CLAUDE_SKILL_DIR}` is the folder this `SKILL.md` is in. If it reaches you unexpanded, write that folder's absolute path in its place.

## Order of work

1. Get a workload that repeats the slow path, and a number to beat.
2. Find the process's inspector port, or start the process with one.
3. Record a profile while the workload runs.
4. Read the report: first whether the time is CPU at all, then where it goes.
5. Change one thing, record again under the same conditions, compare.
6. Report with numbers.

## 1. Workload and baseline

The workload must run the slow path and nothing else, over and over, for at least 10 seconds, so the profile holds thousands of samples. Use, in this order of preference:

- the project's own benchmark script, if it has one for this path;
- `autocannon` against the HTTP route — `npx autocannon -c 1 -d 20 <url>`;
- a small script that calls the slow function in a loop.

Run it once without the profiler and write down its numbers — latency, throughput — before you change anything. That is the baseline.

Hold these the same in every run you will compare:

- **Concurrency.** One request at a time gives the clean per-request cost. More adds contention, and on a laptop the load generator and the database compete with the process for the same CPU.
- **Logging.** Turn verbose and debug logging and SQL echo off, unless logging is what you are measuring. Console output on the hot path is often the biggest cost in a dev setup, and it hides the real one.
- **Build mode.** A dev build is slower than the production bundle. Compare dev with dev.
- **Data.** The same account, the same rows.

## 2. The inspector port

Look for one the process already has:

- `--inspect` or `--inspect=<host:port>` in the start script, or in `NODE_OPTIONS`;
- the IDE's launch configuration;
- the task runner's serve options. For Nx's `@nx/js:node` executor, the `port` option is the inspector's port, not the app's HTTP port, and the inspector is on by default.

The right port answers `/json/list` with a JSON list that names the process. Its root answers `WebSockets request was expected`.

If the process has no inspector, restart it with `node --inspect=127.0.0.1:<port> …`. Never use `--inspect-brk`: it stops the process until a debugger lets it go. In a container, publish the port and pass `--host`.

A one-shot script that exits by itself needs no port. Run it as `node --cpu-prof --cpu-prof-dir=<dir> script.js`, then summarize the `.cpuprofile` it writes there (step 4). There is no meta file then, so busy share comes from the profile's idle samples.

## 3. Record

```bash
node "${CLAUDE_SKILL_DIR}/scripts/profile.js" --port <port> --out <file>.cpuprofile -- <workload command>
```

The script attaches to the process, starts the profiler, runs the workload, and stops when the workload exits. It writes the profile, and `<file>.meta.json` beside it: the event-loop utilization and process CPU over the same window, and the workload's exit code. It does not restart the process or change it.

- The workload is spawned without a shell, and `node` runs as the same Node. On Windows, a `.cmd` launcher such as `npm`, `npx` or `nx` needs `cmd /c` in front of it.
- `--seconds <n>` in place of a workload records for a fixed time, while load comes from somewhere else: the user clicking, another terminal.
- `--interval-us <n>` sets the sampling interval. The default is 1000. Lower it only for a short run; it adds overhead.
- Without `--out`, the file goes under the system temp directory. Profiles are large and specific to one machine: write them to your scratchpad or to a git-ignored directory, never into a commit.
- If the workload exits non-zero, the profile is still written, but the run fails. Read the workload's output before you trust the profile.

Profile the process that does the slow work. When a request crosses several services, first find which service holds the time, then profile that one.

## 4. Read the report

```bash
node "${CLAUDE_SKILL_DIR}/scripts/summarize.js" <file>.cpuprofile
```

Run it from the repository root, so project paths print relative to it, or pass `--root`. `--top` and `--paths` set how many functions and call paths it shows. Locations are mapped through source maps — inline, linked, or `<file>.map` beside the file — so a bundled build points at the original `.ts` file and line.

### CPU or waiting

The header gives the main thread's busy share. Settle this before anything else:

- **Busy well under half the time:** the slow path is mostly waiting — database, network, message broker, a lock, a timer. The function tables explain only the busy part. Do not optimize JavaScript then. Find the wait: time each `await` on the path (`performance.now()` before and after), turn on the ORM's per-query timing (for Sequelize, `benchmark: true` with logging), look at the query plans, and count round trips — one query or RPC per item is the usual cause.
- **Busy most of the time:** the path is CPU-bound. Read on.

With one request at a time, the process also waits while the load generator works. So a low busy share there means "not CPU", but it does not tell you how long each wait was.

### Where the CPU goes

- **Read this first** lists what changes how the tables read: too few samples, mostly waiting, heavy garbage collection, CPU on other threads, a main thread that was blocked rather than computing, a failed workload. Deal with these before the tables. A blocked main thread means synchronous I/O on it, or a machine short of CPU: check the code for `*Sync` calls first, and if there are none, record again with less running beside it.
- **Busy time by origin** shows whose code costs: own code, each npm package, Node internals, V8 builtins and native code, garbage collection, `(program)` (native work V8 cannot attribute, such as compiling). A package near the top usually means it is called too often, or with too much data, not that it is slow. The call paths show which of your calls drive it.
- **Hottest functions by self time** are where the samples landed. Self time is the function's own work. Total time adds everything it called. A function with low self time and high total time only passes the work on.
- **How the hottest functions are reached** gives, for each one, the call paths up to the first frame of your own code, in bold. That frame is usually where the fix goes.
- **Hot line.** V8 compiles small functions into the functions that call them. The profile then shows their time as the caller's self time, and the callee does not appear at all. So a function with surprising self time may be paying for the calls it makes. Its hot line is where most of its samples landed. When that line is a call, the cost is in what it calls. Node's own `listOnTimeout`, `processTicksAndRejections` or `emit` at the top usually means this: your callback was compiled into them. The path above them shows nothing of yours; the hot line and the callback registered there do.

Open the source at the bold frames before you decide anything. Common findings:

- the same work done once per item when it could be done once — serializing, compiling a regex or a schema, validating;
- synchronous work on a large input — `JSON` of a big payload, sorting, deep copies;
- logging and string building on the hot path;
- an ORM that loads or converts more rows or columns than the response uses;
- heavy garbage collection from building large temporary arrays and objects.

## 5. Compare

Change one thing at a time. Record again with the same workload, concurrency, logging, build and data. Compare the workload's own numbers first — latency, throughput. Then compare the profiles: the function you changed should have a smaller share of busy time, and nothing else should have grown to take its place. If the two runs differ by less than about 10%, run each side again: one run on a laptop can vary that much.

## 6. Report

- the baseline and the new numbers, side by side, from the same conditions;
- the cause, as the `file:line` of the code you changed, and what the profile showed about it;
- what the profile did not cover, when it mattered: waiting time, other threads, a process you did not profile.

Keep the profile path in the report, so the user can open the file in Chrome DevTools or VS Code for a flame chart.
