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
  const now = t.command('skillbox-fork:fork-at', 'whatever');
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
    const row = new Transcript().command('skillbox-fork:fork-at', '3 -- go');
    assert.deepEqual(F.commandOf(row), { name: 'skillbox-fork:fork-at', bare: 'fork-at', args: '3 -- go' });
    assert.equal(F.displayText(row), '/skillbox-fork:fork-at 3 -- go');
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

  test('ambiguous text lists every candidate with its @id, and never guesses', () => {
    const { t, a, b } = session();
    // "the" is in turn 2's answer and turn 3's prompt.
    assert.throws(
      () => F.resolveCut(t.rows, { kind: 'text', value: 'the' }),
      (e) => {
        assert.ok(e instanceof CliError);
        assert.match(e.message, /matches 2 turns — pick one/);
        assert.ok(!e.message.includes(`@${a.uuid.slice(0, 8)}`));
        assert.ok(e.message.includes(`@${b.uuid.slice(0, 8)}`));
        assert.match(e.message, /pick one: {3}\/fork-at @/);
        return true;
      },
    );
  });

  test('no match lists the selectable turns, newest first', () => {
    const { t, a, c } = session();
    assert.throws(
      () => F.resolveCut(t.rows, { kind: 'text', value: 'zebra' }),
      (e) => {
        const lines = e.message.split('\n');
        assert.match(lines[0], /nothing matches "zebra"/);
        const first = lines.findIndex((l) => l.includes(`@${c.uuid.slice(0, 8)}`));
        const last = lines.findIndex((l) => l.includes(`@${a.uuid.slice(0, 8)}`));
        assert.ok(first > 0 && last > first, 'newest turn is listed first');
        return true;
      },
    );
  });

  test('fork commands are never selectable and never counted', () => {
    const t = new Transcript();
    const a = t.turn('first', 'one');
    const fork = t.command('skillbox-fork:fork-at', 'first');
    t.assistant('forked');
    t.command('fork-tree');
    t.assistant('tree');
    t.turn('second', 'two');
    const now = t.command('skillbox-fork:fork-at', '1');

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
  test('opens with the marker, then the directive or the idle text', () => {
    assert.equal(F.childPrompt('P', 'C', 'go'), '[fork] parent=P cut=C\n\ngo');
    assert.match(F.childPrompt('P', 'C', null), /^\[fork\] parent=P cut=C\n\nSession forked/);
  });
});

describe('buildInvocation', () => {
  const base = {
    parent: 'aaaaaaaa-0000-4000-8000-000000000000',
    child: 'cccccccc-0000-4000-8000-000000000000',
    cut: { cutUuid: 'dddddddd-0000-4000-8000-000000000000', dropsTurnUuid: 'eeeeeeee-0000-4000-8000-000000000000' },
    prompt: "[fork] parent=a cut=d\n\nfix B3's \"bug\" & $HOME",
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
    assert.equal(inv.args[inv.args.indexOf('--name') + 1], 'fork-aaaaaaaa');
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
    assert.match(inv.command, /^claude -p --resume aaaaaaaa-\S+ .*--name fork-aaaaaaaa$/);
    for (const w of inv.command.split(' ')) assert.match(w, /^[\w.:-]+$/, `word ${w} would need quoting`);
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
