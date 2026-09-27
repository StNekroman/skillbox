// Stands in for the claude binary in end-to-end tests. Records how it was
// called — arguments, stdin, working directory, config directory — as one JSON
// line in $FAKE_CLAUDE_LOG, then exits. A -p call exits with $FAKE_CLAUDE_EXIT
// (default 0), so a failing fork can be simulated.

const fs = require('fs');

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
process.exit(headless ? Number(process.env.FAKE_CLAUDE_EXIT || 0) : 0);
