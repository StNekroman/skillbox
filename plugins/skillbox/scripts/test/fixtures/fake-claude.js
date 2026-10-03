// Stands in for the claude binary in end-to-end tests. Records how it was
// called — arguments, stdin, working directory, config directory — as one JSON
// line in $FAKE_CLAUDE_LOG, then exits. A -p call exits with $FAKE_CLAUDE_EXIT
// (default 0), so a failing fork can be simulated. A -p call that succeeds
// also writes the session's transcript, every row tagged "sdk-cli" as the real
// -p tags them, unless $FAKE_CLAUDE_NO_TRANSCRIPT is set.

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const headless = argv.includes('-p');
const entry = {
  argv,
  cwd: process.cwd(),
  configDir: process.env.CLAUDE_CONFIG_DIR || null,
  nested: process.env.CLAUDE_CODE_CHILD_SESSION || null,
};
if (headless) {
  try {
    entry.stdin = fs.readFileSync(0, 'utf8');
  } catch {
    entry.stdin = '';
  }
}
fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(entry)}\n`);

const status = headless ? Number(process.env.FAKE_CLAUDE_EXIT || 0) : 0;
const sessionId = argv.includes('--session-id') ? argv[argv.indexOf('--session-id') + 1] : null;
if (headless && status === 0 && sessionId && entry.configDir && !process.env.FAKE_CLAUDE_NO_TRANSCRIPT) {
  const dir = path.join(entry.configDir, 'projects', entry.cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const row = (type, content) => JSON.stringify({ type, sessionId, cwd: entry.cwd, entrypoint: 'sdk-cli', message: { role: type, content } });
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), `${row('user', entry.stdin || argv.at(-1))}\n${row('assistant', 'Waiting.')}\n`);
}
process.exit(status);
