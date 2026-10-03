// Test fixtures: synthetic transcripts in the shape Claude Code writes them,
// under a throwaway config directory.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Deterministic, uuid-shaped ids. The first 8 characters are unique per n, so
// an @id prefix test can rely on them, and the full 36 characters satisfy the
// [fork] marker regex.
function id(n, space = 0) {
  const hex = (v, w) => v.toString(16).padStart(w, '0');
  return `${hex(space * 0x1000000 + n, 8)}-0000-4000-8000-${hex(n, 12)}`;
}

// Builds one session's rows, chaining parentUuid the way a live session does.
class Transcript {
  // cwd, when given, is stamped on every row, as Claude Code does.
  constructor(space = 0, cwd = undefined) {
    this.space = space;
    this.cwd = cwd;
    this.rows = [];
    this.n = 0;
    this.last = null;
  }

  add(row) {
    const uuid = id(++this.n, this.space);
    const r = {
      parentUuid: this.last,
      isSidechain: false,
      uuid,
      timestamp: new Date(2026, 0, 1, 0, this.n).toISOString(),
      ...(this.cwd ? { cwd: this.cwd } : {}),
      ...row,
    };
    this.rows.push(r);
    this.last = uuid;
    return r;
  }

  // A row with no uuid of its own, like ai-title or last-prompt.
  meta(row) {
    this.rows.push(row);
    return row;
  }

  human(text) {
    return this.add({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text }] } });
  }

  // A slash command is stored as a plain string, not a content array.
  command(name, args = '') {
    const content =
      `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>` +
      (args ? `\n<command-args>${args}</command-args>` : '');
    return this.add({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content } });
  }

  // A prompt delivered by -p: a user row with no origin.
  headless(text) {
    return this.add({ type: 'user', message: { role: 'user', content: text } });
  }

  assistant(text) {
    return this.add({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
  }

  toolUse(name = 'Read') {
    return this.add({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_x', name, input: {} }] } });
  }

  toolResult(text) {
    return this.add({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: text }] } });
  }

  // One full exchange: prompt, a tool round trip, the answer.
  turn(prompt, answer, toolOutput = 'file contents') {
    const p = this.human(prompt);
    this.toolUse();
    this.toolResult(toolOutput);
    this.assistant(answer);
    return p;
  }

  jsonl() {
    return this.rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  }
}

// A throwaway CLAUDE_CONFIG_DIR. Removed when the test finishes — with retries,
// because a detached FORK_AT_TERMINAL window can outlive the test by a moment,
// and Windows refuses to delete a directory a live process is standing in.
function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillbox-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return root;
}

function writeTranscript(root, sessionId, transcript, project = 'd--proj') {
  const dir = path.join(root, 'projects', project);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, typeof transcript === 'string' ? transcript : transcript.jsonl());
  return file;
}

function writeLedger(root, edges) {
  const lines = edges.map(([parent, child]) => JSON.stringify({ parent, child, cutUuid: id(1) }));
  fs.writeFileSync(path.join(root, 'fork-tree.jsonl'), lines.join('\n') + '\n');
}

// The environment for a script the tests run as a child process: the tests' own,
// minus a debugger's hooks. VS Code's auto-attach sets both variables in its
// terminals, and every node started under them prints "Debugger attached." to
// stderr and lingers on exit — breaking assertions on stderr, and holding temp
// directories open past the test.
function scriptEnv() {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.VSCODE_INSPECTOR_OPTIONS;
  return env;
}

// Sets environment variables for the duration of one test.
function withEnv(t, vars) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

module.exports = { id, Transcript, tempRoot, writeTranscript, writeLedger, scriptEnv, withEnv };
