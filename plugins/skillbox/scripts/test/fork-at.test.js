const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const F = require('../fork-at');
const { CliError } = require('../lib/fork-graph');
const { Transcript } = require('./helpers');

// Three finished turns and the fork-at invocation that is running right now.
function session() {
  const t = new Transcript();
  const a = t.turn('Plan `B3`’s cache layer', 'We should use an LRU.');
  const b = t.turn('What about eviction?', 'Evict on write — the simplest rule.');
  const c = t.turn('Now write the tests', 'Done, see test/cache.test.js.');
  const now = t.command('skillbox:fork-at', 'whatever');
  return { t, a, b, c, now };
}

// The row a cut after `turn` lands on: the parent of the next prompt.
const cutAfter = (rows, next) => rows.find((r) => r.uuid === next.parentUuid).uuid;

const throwsCli = (fn, re) =>
  assert.throws(fn, (e) => e instanceof CliError && re.test(e.message), `expected CliError matching ${re}`);

describe('normalize', () => {
  test('folds markdown, typography, case and whitespace', () => {
    assert.equal(F.normalize('`B3`’s **Fix** — now\n\n  here').text, "b3's fix - now here");
    assert.equal(F.normalize('[link](x) ~~old~~ _em_').text, 'link(x) old em');
  });

  test('maps each kept character back to its source position', () => {
    const raw = '**ab** c';
    const n = F.normalize(raw);
    assert.equal(n.text, 'ab c');
    assert.deepEqual(n.map.map((i) => raw[i]), ['a', 'b', ' ', 'c']);
  });
});

describe('commandOf and displayText', () => {
  test('reads a namespaced command and keeps what was typed', () => {
    const row = new Transcript().command('skillbox:fork-at', '3 -- go');
    assert.deepEqual(F.commandOf(row), { name: 'skillbox:fork-at', bare: 'fork-at', args: '3 -- go' });
    assert.equal(F.displayText(row), '/skillbox:fork-at 3 -- go');
  });

  test('an ordinary prompt is not a command', () => {
    const row = new Transcript().human('hello');
    assert.equal(F.commandOf(row), null);
    assert.equal(F.displayText(row), 'hello');
  });
});

describe('parseSelector', () => {
  test('empty, @id, number and text', () => {
    assert.equal(F.parseSelector(''), null);
    assert.deepEqual(F.parseSelector('@ABCdef'), { kind: 'id', value: 'abcdef' });
    assert.deepEqual(F.parseSelector('12'), { kind: 'offset', value: 12 });
    assert.deepEqual(F.parseSelector('12 monkeys'), { kind: 'text', value: '12 monkeys' });
  });
});

describe('parseArgs', () => {
  test('one quoted string and separate words parse the same', () => {
    const quoted = F.parseArgs(["B3's fix -- try the other approach"]);
    const split = F.parseArgs(["B3's", 'fix', '--', 'try', 'the', 'other', 'approach']);
    for (const r of [quoted, split]) {
      assert.deepEqual(r.selector, { kind: 'text', value: "B3's fix" });
      assert.equal(r.directive, 'try the other approach');
    }
  });

  test('flags count only before the separator', () => {
    const r = F.parseArgs(['--dry-run 2 -- explain --dry-run to me']);
    assert.deepEqual([...r.flags], ['--dry-run']);
    assert.deepEqual(r.selector, { kind: 'offset', value: 2 });
    assert.equal(r.directive, 'explain --dry-run to me');
  });

  test('a directive with no selector, and no arguments at all', () => {
    assert.deepEqual(F.parseArgs(['-- go']), { flags: new Set(), selector: null, directive: 'go' });
    assert.deepEqual(F.parseArgs([]), { flags: new Set(), selector: null, directive: null });
    assert.equal(F.parseArgs(['3 --']).directive, null);
  });

  test('a double dash inside a word is not the separator', () => {
    const r = F.parseArgs(['the --force flag']);
    assert.equal(r.directive, null);
    assert.deepEqual(r.selector, { kind: 'text', value: 'the --force flag' });
  });
});

describe('resolveCut', () => {
  test('no selector keeps everything and drops only the running turn', () => {
    const { t, now } = session();
    const cut = F.resolveCut(t.rows, null);
    assert.equal(cut.cutUuid, cutAfter(t.rows, now));
    assert.equal(cut.dropsTurnUuid, now.uuid);
    assert.equal(cut.droppedTurns, 0);
    assert.equal(cut.total, 3);
  });

  test('an offset drops that many turns and asserts no dropped turn', () => {
    const { t, b } = session();
    const cut = F.resolveCut(t.rows, { kind: 'offset', value: 2 });
    assert.equal(cut.cutUuid, cutAfter(t.rows, b));
    assert.equal(cut.droppedTurns, 2);
    assert.equal(cut.dropsTurnUuid, null);
    assert.equal(cut.selIdx, 0);
  });

  test('an offset past the start fails', () => {
    const { t } = session();
    throwsCli(() => F.resolveCut(t.rows, { kind: 'offset', value: 3 }), /only 3 selectable/);
  });

  test('an @id prefix selects that turn', () => {
    const { t, b, c } = session();
    const cut = F.resolveCut(t.rows, { kind: 'id', value: b.uuid.slice(0, 8) });
    assert.equal(cut.cutUuid, cutAfter(t.rows, c));
    assert.equal(cut.id, b.uuid.slice(0, 8));
    assert.equal(cut.name, `Fork: ${cut.label}`, 'an id says nothing, so the turn names the fork');
  });

  test('an unknown or ambiguous @id fails', () => {
    const { t } = session();
    throwsCli(() => F.resolveCut(t.rows, { kind: 'id', value: 'ffffffff' }), /no turn with id/);
    throwsCli(() => F.resolveCut(t.rows, { kind: 'id', value: '0000' }), /matches 3 turns/);
  });

  test('text copied from the rendered chat matches the markdown source', () => {
    const { t, b } = session();
    const cut = F.resolveCut(t.rows, { kind: 'text', value: "b3's cache" });
    assert.equal(cut.cutUuid, cutAfter(t.rows, b));
    assert.equal(cut.where, 'your prompt');
    assert.equal(cut.name, "Fork: b3's cache", 'search text names the fork, as typed');
  });

  test('text in the answer selects the turn it belongs to', () => {
    const { t, c } = session();
    const cut = F.resolveCut(t.rows, { kind: 'text', value: 'evict on write - the' });
    assert.equal(cut.cutUuid, cutAfter(t.rows, c));
    assert.equal(cut.where, 'the answer');
  });

  test('tool output is not searched', () => {
    const { t } = session();
    throwsCli(() => F.resolveCut(t.rows, { kind: 'text', value: 'file contents' }), /nothing matches/);
  });

  // The lines of a CliError's message, and the index of the line naming a row.
  const errorLines = (fn) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof CliError, `expected CliError, got ${e}`);
      return e.message.split('\n');
    }
    assert.fail('expected a CliError');
  };
  const lineOf = (lines, row) => lines.findIndex((l) => l.includes(`@${row.uuid.slice(0, 8)}`));

  test('ambiguous text lists every candidate oldest first, with the other half of its exchange', () => {
    const { t, a, b, c } = session();
    // "the" is in turn 2's answer and turn 3's prompt.
    const lines = errorLines(() => F.resolveCut(t.rows, { kind: 'text', value: 'the' }));
    assert.match(lines[0], /matches 2 turns — pick one/);
    assert.equal(lineOf(lines, a), -1);

    const ib = lineOf(lines, b);
    const ic = lineOf(lines, c);
    assert.ok(ib > 0 && ic > ib, 'the conversation order: turn 2 before turn 3');
    assert.match(lines[ib], /^ {2}turn 2 of 3 +@\w{8} {2}the answer +.*the simplest rule/);
    assert.match(lines[ib + 1], /^ +you: What about eviction\?$/);
    assert.match(lines[ic], /^ {2}turn 3 of 3 +@\w{8} {2}your prompt +Now write the tests/);
    assert.match(lines[ic + 1], /^ +answer: Done, see test\/cache\.test\.js\.$/);

    // Namespaced: a plugin command does not answer to its bare name. And no
    // offset: it counts backwards, against the order of the list.
    assert.equal(lines.at(-1), `pick one:   /skillbox:fork-at @${c.uuid.slice(0, 8)}   stable, always this turn`);
    assert.ok(!lines.some((l) => /counts back/.test(l)));
  });

  // The reported bug: two identical prompts, and picking "the first" forked at
  // the second.
  test('identical prompts are told apart by turn number and answer, in conversation order', () => {
    const t = new Transcript();
    const first = t.turn('How do you do?', 'Doing well, thanks.');
    const between = t.turn('Something else', 'Sure.');
    const second = t.turn('How do you do?', 'Still good, nothing changed.');
    t.command('skillbox:fork-at', 'How do you do?');

    const lines = errorLines(() => F.resolveCut(t.rows, { kind: 'text', value: 'How do you do?' }));
    const i1 = lineOf(lines, first);
    const i2 = lineOf(lines, second);
    assert.ok(i1 > 0 && i2 > i1, 'the earlier turn is listed first');
    assert.match(lines[i1], /turn 1 of 3/);
    assert.match(lines[i1 + 1], /answer: Doing well, thanks\.$/);
    assert.match(lines[i2], /turn 3 of 3/);
    assert.match(lines[i2 + 1], /answer: Still good, nothing changed\.$/);

    // The @id on the first line forks after the first turn, not the second.
    const cut = F.resolveCut(t.rows, { kind: 'id', value: first.uuid.slice(0, 8) });
    assert.equal(cut.selIdx, 0);
    assert.equal(cut.cutUuid, cutAfter(t.rows, between));
  });

  test('no match lists the selectable turns oldest first', () => {
    const { t, a, b, c } = session();
    const lines = errorLines(() => F.resolveCut(t.rows, { kind: 'text', value: 'zebra' }));
    assert.match(lines[0], /nothing matches "zebra"/);
    assert.equal(lines[2], 'turns you can select, oldest first:');
    const [ia, ib, ic] = [a, b, c].map((r) => lineOf(lines, r));
    assert.ok(ia > 2 && ib > ia && ic > ib);
    assert.match(lines[ia], /^ {2}turn 1 of 3 +@\w{8} {2}"Plan `B3`’s cache layer"$/);
    assert.match(lines[ia + 1], /^ +answer: We should use an LRU\.$/);
  });

  test('a long conversation lists only its latest turns, still oldest first', () => {
    const t = new Transcript();
    const rows = Array.from({ length: 15 }, (_, i) => t.turn(`prompt ${i + 1}`, `answer ${i + 1}`));
    t.command('fork-at');
    const lines = errorLines(() => F.resolveCut(t.rows, { kind: 'text', value: 'zebra' }));
    assert.equal(lines[2], 'your latest 12 turns, oldest first:');
    assert.equal(lineOf(lines, rows[2]), -1, 'turn 3 is past the window');
    assert.match(lines[lineOf(lines, rows[3])], /turn 4 of 15/);
    assert.ok(lineOf(lines, rows[14]) > lineOf(lines, rows[3]));
  });

  test('fork commands are never selectable and never counted', () => {
    const t = new Transcript();
    const a = t.turn('first', 'one');
    const fork = t.command('skillbox:fork-at', 'first');
    t.assistant('forked');
    t.command('fork-tree');
    t.assistant('tree');
    t.turn('second', 'two');
    const now = t.command('skillbox:fork-at', '1');

    const cut = F.resolveCut(t.rows, { kind: 'offset', value: 1 });
    assert.equal(cut.total, 2);
    assert.equal(cut.id, a.uuid.slice(0, 8));
    // Cuts just before the hidden fork turn, which is what the next prompt is.
    assert.equal(cut.cutUuid, cutAfter(t.rows, fork));
    assert.equal(cut.dropsTurnUuid, null);

    throwsCli(() => F.resolveCut(t.rows, { kind: 'text', value: 'fork-tree' }), /nothing matches/);
    assert.equal(F.resolveCut(t.rows, null).dropsTurnUuid, now.uuid);
  });

  test('a session with nothing finished yet cannot be forked', () => {
    const t = new Transcript();
    t.command('fork-at');
    throwsCli(() => F.resolveCut(t.rows, null), /no completed turns/);
  });

  test('a session of only fork commands cannot be forked', () => {
    const t = new Transcript();
    t.command('fork-tree');
    t.command('fork-at');
    throwsCli(() => F.resolveCut(t.rows, null), /only fork commands/);
  });

  test('-p prompts are not turns', () => {
    const t = new Transcript();
    t.headless("[fork] parent=x cut=y\n\nWait for next user's input.");
    t.assistant('Waiting.');
    const a = t.turn('real work', 'ok');
    t.command('fork-at');
    const cut = F.resolveCut(t.rows, null);
    assert.equal(cut.total, 1);
    assert.equal(cut.id, a.uuid.slice(0, 8));
  });
});

describe('snippet', () => {
  test('centres on the match and marks both cuts', () => {
    const raw = `${'x'.repeat(100)} needle ${'y'.repeat(100)}`;
    const s = F.snippet(raw, F.normalize(raw), 'needle', 20);
    assert.match(s, /^….*needle.*…$/);
  });

  test('falls back to a preview when the needle is absent', () => {
    assert.equal(F.snippet('short text', F.normalize('short text'), 'zzz', 20), 'short text');
  });
});

describe('childPrompt', () => {
  // The headless turn runs unattended, so it only ever carries the idle text.
  test('opens with the marker, then the idle text — never a directive', () => {
    assert.equal(F.childPrompt('P', 'C', 'rm -rf everything').includes('rm -rf'), false);
    assert.match(F.childPrompt('P', 'C'), /^\[fork\] parent=P cut=C\n\nSession forked[\s\S]*Wait for next user's input\.$/);
  });

  test('the marker is what the edge scanner recognises', () => {
    const { MARKER } = require('../lib/fork-graph');
    const P = 'aaaaaaaa-0000-4000-8000-000000000000';
    const C = 'dddddddd-0000-4000-8000-000000000000';
    const m = MARKER.exec(F.childPrompt(P, C));
    assert.equal(m && m.index, 0);
    assert.deepEqual([m[1], m[2]], [P, C]);
  });
});

describe('buildResume', () => {
  const child = 'cccccccc-0000-4000-8000-000000000000';
  const directive = 'fix B3\'s "cache" bug & run\nthe tests';

  test('a real binary gets the directive untouched, as its own argument', () => {
    for (const [exe, platform] of [['C:\\bin\\claude.exe', 'win32'], ['claude', 'linux'], ['/usr/bin/claude', 'darwin']]) {
      const inv = F.buildResume({ exe, child, directive, platform });
      assert.equal(inv.shell, false);
      assert.equal(inv.command, exe);
      assert.deepEqual(inv.args, ['--resume', child, directive]);
    }
  });

  test('no directive, no prompt argument', () => {
    assert.deepEqual(F.buildResume({ exe: 'claude', child, directive: null, platform: 'linux' }).args, ['--resume', child]);
    assert.equal(F.buildResume({ exe: 'claude', child, directive: null, platform: 'win32' }).command, `claude --resume ${child}`);
  });

  // Through cmd.exe a double quote inside the argument would end the quoting
  // and hand `&` to cmd as a command separator.
  test('through cmd.exe the directive is one quoted word with no quote inside it', () => {
    const inv = F.buildResume({ exe: 'C:\\Program Files\\npm\\claude.cmd', child, directive, platform: 'win32' });
    assert.equal(inv.shell, true);
    assert.deepEqual(inv.args, []);
    assert.equal(inv.command, `"C:\\Program Files\\npm\\claude.cmd" --resume ${child} "fix B3's 'cache' bug & run the tests"`);
    const tail = inv.command.slice(inv.command.indexOf(child) + child.length + 1);
    assert.equal((tail.match(/"/g) || []).length, 2, 'only the wrapping pair');
  });
});

describe('buildSpec', () => {
  const cut = { cutUuid: 'cut', dropsTurnUuid: 'drop', droppedTurns: 2, label: 'the turn', name: 'Fork: the turn' };

  test('records the session directory from the transcript, not the caller', () => {
    const t = new Transcript(0, '/work/project');
    t.turn('hi', 'hello');
    const spec = F.buildSpec({ root: '/cfg', rows: t.rows, parent: 'P', child: 'C', cut, directive: 'go', env: {}, fallbackCwd: '/somewhere/else' });
    assert.equal(spec.cwd, '/work/project');
    assert.deepEqual(
      { cutUuid: spec.cutUuid, dropsTurnUuid: spec.dropsTurnUuid, droppedTurns: spec.droppedTurns, label: spec.label, name: spec.name, directive: spec.directive },
      { cutUuid: 'cut', dropsTurnUuid: 'drop', droppedTurns: 2, label: 'the turn', name: 'Fork: the turn', directive: 'go' },
    );
  });

  test('falls back to the caller directory when the transcript has none', () => {
    const t = new Transcript();
    t.turn('hi', 'hello');
    assert.equal(F.buildSpec({ root: '/cfg', rows: t.rows, parent: 'P', child: 'C', cut, env: {}, fallbackCwd: '/here' }).cwd, '/here');
  });

  // A window may start from a fresh environment, so the spec has to carry
  // what the parent's environment would otherwise have supplied.
  test('captures the config directory and the resolved binary', () => {
    const env = { CLAUDE_CONFIG_DIR: '/custom/cfg', CLAUDE_CODE_EXECPATH: '/opt/claude/bin/claude' };
    const spec = F.buildSpec({ root: '/custom/cfg', rows: [], parent: 'P', child: 'C', cut, env });
    assert.equal(spec.configDir, '/custom/cfg');
    assert.equal(spec.exe, '/opt/claude/bin/claude');
    assert.equal(spec.directive, null);
    const bare = F.buildSpec({ root: '/home/me/.claude', rows: [], parent: 'P', child: 'C', cut, env: {} });
    assert.equal(bare.configDir, null, 'the default location is left to the default');
    assert.equal(bare.exe, 'claude');
  });
});

describe('finishCommand', () => {
  test('absolute node and script, spaced paths quoted', () => {
    assert.equal(
      F.finishCommand('C:\\Users\\A B\\.claude\\fork-pending\\c.json', 'C:\\Program Files\\nodejs\\node.exe', 'D:\\p\\fork-at.js'),
      '"C:\\Program Files\\nodejs\\node.exe" D:\\p\\fork-at.js --finish "C:\\Users\\A B\\.claude\\fork-pending\\c.json"',
    );
  });

  test('defaults to this node and this script', () => {
    const cmd = F.finishCommand('/tmp/x.json');
    assert.ok(cmd.includes(require('path').join(__dirname, '..', 'fork-at.js')));
    assert.ok(cmd.includes(process.execPath));
  });
});

describe('childEnv', () => {
  test('points at the parent config directory and never looks nested', () => {
    const env = F.childEnv({ configDir: '/custom/cfg' }, { CLAUDE_CONFIG_DIR: '/wrong', PATH: '/bin' });
    assert.equal(env.CLAUDE_CONFIG_DIR, '/custom/cfg');
    assert.equal(env.PATH, '/bin');
    assert.equal(F.childEnv({ configDir: null }, { PATH: '/bin' }).CLAUDE_CONFIG_DIR, undefined);
  });
});

describe('pendingFile', () => {
  test('one file per child, under the config directory', () => {
    assert.equal(F.pendingFile('/cfg', 'C'), require('path').join('/cfg', 'fork-pending', 'C.json'));
  });
});

describe('forkName', () => {
  test('search text, as typed, else the matched prompt', () => {
    assert.equal(F.forkName({ kind: 'text', value: "B3's  cache" }, 'ignored'), "Fork: B3's cache");
    assert.equal(F.forkName({ kind: 'id', value: 'abcd' }, 'the turn'), 'Fork: the turn');
    assert.equal(F.forkName({ kind: 'offset', value: 1 }, 'the turn'), 'Fork: the turn');
    assert.equal(F.forkName(null, 'the turn'), 'Fork: the turn');
  });

  test('is one line and no longer than a picker row', () => {
    const name = F.forkName({ kind: 'text', value: `${'x'.repeat(80)}\nmore` }, '');
    assert.ok(!name.includes('\n'));
    assert.equal(name, `Fork: ${'x'.repeat(55)}…`);
    assert.equal(F.forkName(null, ''), 'Fork');
  });
});

describe('buildInvocation', () => {
  const base = {
    parent: 'aaaaaaaa-0000-4000-8000-000000000000',
    child: 'cccccccc-0000-4000-8000-000000000000',
    cut: { cutUuid: 'dddddddd-0000-4000-8000-000000000000', dropsTurnUuid: 'eeeeeeee-0000-4000-8000-000000000000' },
    prompt: "[fork] parent=a cut=d\n\nfix B3's \"bug\" & $HOME",
    name: 'Fork: B3\'s "cache" & the\ttests',
  };

  test('a real binary gets the prompt as its last argument, with no shell', () => {
    const inv = F.buildInvocation({ ...base, exe: 'C:\\Program Files\\claude.exe', platform: 'win32' });
    assert.equal(inv.shell, false);
    assert.equal(inv.command, 'C:\\Program Files\\claude.exe');
    assert.equal(inv.args.at(-1), base.prompt);
    assert.equal(inv.input, null);
    assert.deepEqual(inv.args.slice(inv.args.indexOf('--resume-drops-turn'), inv.args.indexOf('--resume-drops-turn') + 2), [
      '--resume-drops-turn',
      base.cut.dropsTurnUuid,
    ]);
    assert.equal(inv.args[inv.args.indexOf('--name') + 1], base.name, 'the name is passed untouched');
  });

  test('on POSIX a bare claude is still spawned without a shell', () => {
    const inv = F.buildInvocation({ ...base, exe: 'claude', platform: 'linux' });
    assert.equal(inv.shell, false);
    assert.equal(inv.args.at(-1), base.prompt);
  });

  // The bug: with a shell, Node joins the arguments unquoted and the
  // multi-line prompt is split apart.
  test('through a shell, the prompt goes on stdin and the command line is shell-safe', () => {
    const inv = F.buildInvocation({ ...base, exe: 'claude', platform: 'win32' });
    assert.equal(inv.shell, true);
    assert.equal(inv.input, base.prompt);
    assert.deepEqual(inv.args, [], 'one pre-joined string, no argument list alongside the shell');
    const [head, name] = inv.command.split(' --name ');
    assert.match(head, /^claude -p --resume aaaaaaaa-\S+ /);
    for (const w of head.split(' ')) assert.match(w, /^[\w.:-]+$/, `word ${w} would need quoting`);
    assert.equal(name, `"Fork: B3's 'cache' & the tests"`, 'one quoted word with no quote inside it');
  });

  test('a shelled path with a space is quoted', () => {
    const inv = F.buildInvocation({ ...base, exe: 'C:\\Program Files\\npm\\claude.cmd', platform: 'win32' });
    assert.ok(inv.command.startsWith('"C:\\Program Files\\npm\\claude.cmd" -p --resume '));
  });

  test('no --resume-drops-turn when the cut spans more than the running turn', () => {
    const inv = F.buildInvocation({ ...base, cut: { ...base.cut, dropsTurnUuid: null }, exe: 'claude', platform: 'linux' });
    assert.ok(!inv.args.includes('--resume-drops-turn'));
  });
});
