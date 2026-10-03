const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const D = require('../../skills/to-sdd/scripts/lib/sdd-doc');
const { body, section, readme, prng } = require('./sdd-helpers');

const { README } = D;
const ctx = (maxLines = 1000) => ({ id: 'SDD001', maxLines });
const issuesOf = (files, maxLines) => D.checkDoc(D.buildModel(files), ctx(maxLines));
const messages = (issues) => issues.map((x) => `${x.file}${x.line ? `:${x.line}` : ''}: ${x.message}`);
const only = (lines) => new Map([[README, lines]]);

// A doc's own text in reading order, whichever files hold it: what README.md has above its first
// section, then every section's text in anchor order. Without what fix generates or drops on the
// way: the index, breadcrumbs, blank lines, thematic breaks and the number of #s on a heading.
function prose(files) {
  const top = [];
  const chunks = [];
  for (const [name, all] of files) {
    let lines = all;
    if (name === README) {
      const a = lines.indexOf(D.INDEX_OPEN);
      if (a >= 0) lines = [...lines.slice(0, a), ...lines.slice(lines.indexOf(D.INDEX_CLOSE) + 1)];
      lines = lines.filter((l) => l !== '## Index');
    }
    const starts = D.scanFile(name, lines).headings.filter((h) => h.section);
    if (name === README) top.push(...lines.slice(0, starts.length ? starts[0].i : lines.length));
    starts.forEach((h, k) => chunks.push({ anchor: h.section.anchor, lines: lines.slice(h.i, starts[k + 1] ? starts[k + 1].i : lines.length) }));
  }
  chunks.sort((a, b) => D.compareAnchors(a.anchor, b.anchor));
  return [...top, ...chunks.flatMap((c) => c.lines)]
    .filter((l) => l.trim() && !/^-{3,}$/.test(l.trim()))
    .map((l) => l.replace(/^#{1,6} /, '# '));
}

// §1 Overview, §2 Delivery with §2.1 Retries: 22 lines before fix adds an index.
const mail = () =>
  only([
    ...readme('SDD001', 'Mail'),
    ...section('1', 'Overview', body('one', 3)),
    ...section('2', 'Delivery', body('two', 3)),
    ...section('2.1', 'Retries', body('two-one', 3)),
  ]);

describe('scanning', () => {
  test('a heading inside a code fence is text, not a section', () => {
    const m = D.buildModel(only([...readme('SDD001', 'A'), '```md', '## §9 Not a section', '```', '', ...section('1', 'Real')]));
    assert.deepEqual([...m.sections.keys()], ['1']);
  });

  test('closing hashes are dropped; a # inside the title stays', () => {
    const m = D.buildModel(only([...readme('SDD001', 'A'), '## §1 C# client ##']));
    assert.equal(m.sections.get('1').title, 'C# client');
  });

  test('sections sort by number, part by part, parents first', () => {
    assert.deepEqual(['3.10', '3', '10', '3.2', '3.2.1'].sort(D.compareAnchors), ['3', '3.2', '3.2.1', '3.10', '10']);
  });
});

describe('README.md', () => {
  const withAbstract = (abstract) => only(readme('SDD001', 'A', [], abstract));
  const abstractIssues = (files) => issuesOf(files).filter((x) => /abstract/.test(x.message));

  test('an abstract of 500 characters passes; 501 does not', () => {
    assert.deepEqual(abstractIssues(withAbstract('x'.repeat(500))), []);
    assert.deepEqual(messages(abstractIssues(withAbstract('x'.repeat(501)))), [
      'README.md:3: the abstract is 501 characters; the limit is 500',
    ]);
  });

  test('a wrapped abstract is one paragraph, its line breaks counted as spaces', () => {
    const files = only(['# SDD001 — A', '', 'a'.repeat(250), 'b'.repeat(250), '', '> not part of it']);
    assert.equal(D.abstractOf(D.buildModel(files).files.get(README)).text.length, 501);
  });

  test('a README that opens with a quote has no abstract', () => {
    assert.ok(messages(issuesOf(only(['# SDD001 — A', '', '> quoted']))).some((m) => /no abstract/.test(m)));
  });

  test("the title names the folder's SDD", () => {
    assert.ok(messages(issuesOf(only(readme('SDD002', 'A')))).includes('README.md:1: the title says SDD002, but the folder is SDD001'));
  });
});

describe('structural problems stop fix, and it changes nothing', () => {
  const cases = [
    ['a duplicated anchor', [...section('1', 'A'), ...section('1', 'B')], /§1 is defined twice/],
    ['a section with no parent', [...section('1', 'A'), ...section('2.1', 'B')], /§2\.1 has no parent: there is no §2/],
    ['an unnumbered heading at section level', [...section('1', 'A'), '## Appendix', '', 'x'], /"Appendix" sits at section level inside §1/],
    ['a malformed section heading', ['## §3. Dotted', ''], /malformed section heading "§3\. Dotted"/],
  ];
  for (const [name, rest, re] of cases) {
    test(name, () => {
      const input = only(readme('SDD001', 'A', rest));
      const res = D.fixDoc(input, ctx(1));
      assert.equal(res.files, input);
      assert.ok(res.blocked.some((x) => re.test(x.message)), messages(res.blocked).join('\n'));
    });
  }

  test('an unnumbered heading deeper than its section is part of that section, and moves with it', () => {
    const input = only(readme('SDD001', 'A', [...section('1', 'A', ['x', '', '### Notes', '', 'y']), ...section('2', 'B')]));
    const res = D.fixDoc(input, ctx(12));
    assert.equal(res.blocked, null);
    assert.deepEqual(res.files.get('1.md').slice(2), ['## §1 A', '', 'x', '', '### Notes', '', 'y']);
  });
});

describe('section files', () => {
  const withFile = (name, lines) => new Map([[README, readme('SDD001', 'A', section('1', 'One'))], [name, lines]]);

  test('only the breadcrumb may sit above the heading', () => {
    const issues = issuesOf(withFile('2.md', ['Stray text', '', ...section('2', 'Two')]));
    assert.ok(issues.some((x) => x.structural && x.message === 'text above the §2 heading; only the breadcrumb goes there'));
  });

  test('a file holds the section it is named for', () => {
    assert.ok(messages(issuesOf(withFile('3.md', section('2', 'Two')))).includes('3.md:1: must open with the heading of §3'));
  });

  test('a file named for no section is flagged', () => {
    assert.ok(messages(issuesOf(withFile('notes.md', ['x']))).some((m) => m.startsWith('notes.md: not a section file')));
  });

  test('a section file whose parent has none is moved into the file that holds the parent', () => {
    const files = new Map([[README, readme('SDD001', 'A', section('1', 'One'))], ['1.1.md', section('1.1', 'Sub')]]);
    assert.ok(
      messages(issuesOf(files)).includes('1.1.md:1: §1.1 has its own file, but its parent §1 does not; fix moves it into README.md'),
    );
    const res = D.fixDoc(files, ctx());
    assert.deepEqual([...res.files.keys()], [README]);
    assert.deepEqual(res.actions, ['moved §1.1 into README.md, where its parent is', 'regenerated the index']);
    assert.deepEqual(prose(res.files), prose(files));
    assert.deepEqual(issuesOf(res.files), []);
  });

  test('a section written into another section’s file is moved to its parent’s file', () => {
    const files = new Map([
      [README, readme('SDD001', 'A', [...section('1', 'One'), ...section('3', 'Three')])],
      ['2.md', ['> [SDD001 — A](README.md)', '', ...section('2', 'Two'), ...section('1.1', 'Stray')]],
    ]);
    assert.ok(messages(issuesOf(files)).includes('2.md:7: §1.1 belongs in README.md, with its parent; fix moves it there'));
    const res = D.fixDoc(files, ctx());
    assert.deepEqual(res.actions, ['moved §1.1 into README.md, where its parent is', 'merged §2 back into README.md', 'regenerated the index']);
    const out = res.files.get(README);
    assert.deepEqual(
      out.filter((l) => /^#+ §/.test(l)),
      ['## §1 One', '### §1.1 Stray', '## §2 Two', '## §3 Three'],
    );
    assert.deepEqual(prose(res.files), prose(files));
  });
});

describe('text', () => {
  test('a line-number citation is an error, outside code fences', () => {
    const files = only(
      readme('SDD001', 'A', section('1', 'One', ['See orders.service.ts:120 and [x](blob/main/a.tsx#L4).', '', '```', 'at a.ts:3', '```', 'Port localhost:8080, file.ts alone.'])),
    );
    assert.deepEqual(messages(issuesOf(files).filter((x) => /line number/.test(x.message))), [
      'README.md:7: cites a line number, orders.service.ts:120: lines move with every change, so cite the symbol',
    ]);
  });
});

describe('lint', () => {
  const lint = (lines) => D.lintDoc(D.buildModel(only(readme('SDD001', 'A', section('1', 'One', lines))))).map((x) => `${x.i + 1}: ${x.message}`);

  test('wording that tells history is a lead; the same words in a current-state sense are not', () => {
    assert.deepEqual(lint(['The cron used to run hourly.', 'Since SDD013§P6 it is per shop.', 'Update: moved.', 'The key is used to sign.']), [
      '7: reads as history, "used to": state what is true now',
      '8: reads as history, "Since SDD013": state what is true now',
      '9: reads as history, "Update:": state what is true now',
    ]);
    assert.deepEqual(lint(['This replaced a static cron.', 'The node briefly carried a name.', 'They were briefly two spans.']), [
      '7: reads as history, "replaced a": state what is true now',
      '8: reads as history, "briefly carried": state what is true now',
      '9: reads as history, "were briefly": state what is true now',
    ]);
    assert.deepEqual(
      lint(['No longer than 500 characters.', 'A refresh replaces the token.', '`used_to` and [notes](previously.md)', 'It is replaced by a copy.', 'The button is briefly disabled.', 'Then it briefly goes down.']),
      [],
    );
  });

  test('a label in a section title is a lead for the content step', () => {
    const out = D.lintDoc(D.buildModel(only(readme('SDD001', 'A', section('1', 'Sellers as of (§P1), see SDD013§P2'))))).map((x) => `${x.i + 1}: ${x.message}`);
    assert.deepEqual(out, ['5: the title carries a label, "§P1": drop it once no reference cites the label']);
  });

  test('a fence with a language is copied code; a diagram or plain text is not', () => {
    assert.deepEqual(lint(['```ts', 'const a = 1;', 'const b = 2;', '```', '', '```mermaid', 'graph', '```', '', '```', 'box', '```']), [
      '7: a 2-line ```ts block: copied code goes stale; state the rule it shows and cite the symbol',
    ]);
  });

  test('only names with the shape of code are looked for in the code', () => {
    const shape = (t) => {
      const n = D.codeName(t);
      return n ? `${n.kind}:${n.probe}` : null;
    };
    assert.deepEqual(
      [
        'OrdersService.senderConfig()',
        'updateOffer(id, dto)',
        'NOVAPOSHTA_API_KEY',
        'apps/api/src/orders.service.ts',
        'src/orders/',
        'apps/web/.../cart/cart.ts',
        'orders.service.ts',
        '@InjectRepository',
      ].map(shape),
      ['name:senderConfig', 'name:updateOffer', 'name:NOVAPOSHTA_API_KEY', 'path:apps/api/src/orders.service.ts', 'dir:src/orders', 'path:cart/cart.ts', 'file:orders.service.ts', 'name:InjectRepository'],
    );
    assert.deepEqual(
      ['pending', 'Order', 'npRef/npTtn', '/orders/:id', 'api.example.com/v1/', 'isXxxDestination', '_FLOOR', 'GET /x', 'a.b', 'KEY_*', 'x = 1'].map(shape),
      new Array(11).fill(null),
    );
  });
});

describe('fix', () => {
  test('under the limit, it only adds the index, before the first section', () => {
    const res = D.fixDoc(mail(), ctx(1000));
    assert.deepEqual([...res.files.keys()], [README]);
    assert.deepEqual(res.actions, ['regenerated the index']);
    assert.deepEqual(res.files.get(README).slice(4, 13), [
      '## Index',
      '',
      D.INDEX_OPEN,
      '- §1 Overview',
      '- §2 Delivery',
      '  - §2.1 Retries',
      D.INDEX_CLOSE,
      '',
      '## §1 Overview',
    ]);
  });

  test('over the limit, sections move out largest first, until README.md keeps only the rest', () => {
    const res = D.fixDoc(mail(), ctx(20));
    assert.deepEqual([...res.files.keys()].sort(), ['1.md', '2.md', README]);
    assert.deepEqual(res.files.get(README), [
      '# SDD001 — Mail',
      '',
      'What SDD001 covers, in one short paragraph.',
      '',
      '## Index',
      '',
      D.INDEX_OPEN,
      '- [§1 Overview](1.md)',
      '- [§2 Delivery](2.md)',
      '  - [§2.1 Retries](2.md)',
      D.INDEX_CLOSE,
    ]);
    assert.deepEqual(res.files.get('2.md'), [
      '> [SDD001 — Mail](README.md)',
      '',
      '## §2 Delivery',
      '',
      ...body('two', 3),
      '',
      '### §2.1 Retries',
      '',
      ...body('two-one', 3),
    ]);
    assert.deepEqual(issuesOf(res.files, 20), []);
  });

  test('a file still over the limit splits again in the same run', () => {
    const input = only([
      ...readme('SDD001', 'Mail'),
      ...section('1', 'Overview', body('one', 3)),
      ...section('2', 'Delivery', body('two', 2)),
      ...section('2.1', 'Retries', body('two-one', 5)),
      ...section('2.2', 'Backoff', body('two-two', 5)),
    ]);
    const res = D.fixDoc(input, ctx(12));
    assert.deepEqual(res.actions, [
      'moved §1, §2 out of README.md into their own files',
      'moved §2.1, §2.2 out of 2.md into their own files',
      'regenerated the index',
    ]);
    assert.deepEqual(res.files.get('2.1.md').slice(0, 3), ['> [SDD001 — Mail](README.md) › [§2 Delivery](2.md)', '', '### §2.1 Retries']);
    assert.deepEqual(res.files.get('2.md'), ['> [SDD001 — Mail](README.md)', '', '## §2 Delivery', '', ...body('two', 2)]);
    assert.ok(res.files.get(README).includes('  - [§2.2 Backoff](2.2.md)'));
    assert.deepEqual(issuesOf(res.files, 12), []);
  });

  test('only the largest move out: the small sections stay with their parent', () => {
    // 34 lines at a limit of 30: moving §2 out leaves 19, within two-thirds of 30.
    const input = only(readme('SDD001', 'A', [...section('1', 'One'), ...section('2', 'Two', body('two', 12)), ...section('3', 'Three')]));
    const res = D.fixDoc(input, ctx(30));
    assert.deepEqual([...res.files.keys()].sort(), ['2.md', README]);
    assert.deepEqual(res.actions, ['moved §2 out of README.md into its own file', 'regenerated the index']);
    const out = res.files.get(README);
    assert.deepEqual(out.slice(out.indexOf(D.INDEX_OPEN) + 1, out.indexOf(D.INDEX_CLOSE)), ['- §1 One', '- [§2 Two](2.md)', '- §3 Three']);
    assert.ok(out.length <= 20, `${out.length} lines`);
    assert.deepEqual(issuesOf(res.files, 30), []);
    assert.deepEqual(D.fixDoc(res.files, ctx(30)).actions, []);
  });

  test('when a section’s own text is over two-thirds of the limit, its file is split only down to the limit', () => {
    // 1.md: §1's own text is 17 lines, over 13, so the file stops at 20 with §1.2 still in it.
    const input = only(
      readme('SDD001', 'A', [...section('1', 'One', body('one', 12)), ...section('1.1', 'Sub', body('sub', 5)), ...section('1.2', 'Small')]),
    );
    const res = D.fixDoc(input, ctx(20));
    assert.deepEqual([...res.files.keys()].sort(), ['1.1.md', '1.md', README]);
    assert.ok(res.files.get('1.md').includes('### §1.2 Small'));
    assert.ok(res.files.get('1.md').length <= 20, `${res.files.get('1.md').length} lines`);
    assert.deepEqual(issuesOf(res.files, 20), []);
    assert.deepEqual(D.fixDoc(res.files, ctx(20)).actions, []);
  });

  test('a section file that fits back into its parent’s file is merged back; one that does not stays', () => {
    const split = D.fixDoc(
      only(readme('SDD001', 'A', [...section('1', 'One', body('one', 2)), ...section('2', 'Two', body('two', 30)), ...section('3', 'Three', body('three', 2))])),
      ctx(10),
    ).files;
    assert.deepEqual([...split.keys()].sort(), ['1.md', '2.md', '3.md', README]);
    assert.deepEqual(
      messages(issuesOf(split, 40).filter((x) => x.fixable)),
      ['1.md: §1 fits back into README.md, 16 lines together, within 26; fix merges it', '3.md: §3 fits back into README.md, 16 lines together, within 26; fix merges it'],
    );
    const res = D.fixDoc(split, ctx(40));
    assert.deepEqual(res.actions, ['merged §1, §3 back into README.md', 'regenerated the index']);
    assert.deepEqual([...res.files.keys()].sort(), ['2.md', README]);
    assert.deepEqual(prose(res.files), prose(split));
    assert.deepEqual(issuesOf(res.files, 40), []);
  });

  test('a new section written in its parent’s file stays there while the file has room', () => {
    const files = D.fixDoc(mail(), ctx(20)).files;
    files.set(README, [...files.get(README), '', ...section('3', 'Late addition')]);
    const res = D.fixDoc(files, ctx(20));
    assert.deepEqual(res.actions, ['regenerated the index']);
    assert.ok(!res.files.has('3.md'));
    assert.ok(res.files.get(README).includes('- §3 Late addition'));
    assert.deepEqual(issuesOf(res.files, 20), []);
  });

  test('a title change refreshes the index and breadcrumbs, and renames no file', () => {
    const files = D.fixDoc(
      only([...readme('SDD001', 'Mail'), ...section('1', 'Overview', body('one', 3)), ...section('2', 'Delivery', body('two', 2)), ...section('2.1', 'Retries', body('two-one', 5)), ...section('2.2', 'Backoff', body('two-two', 5))]),
      ctx(12),
    ).files;
    const names = [...files.keys()].sort();
    files.set('2.md', files.get('2.md').map((l) => (l === '## §2 Delivery' ? '## §2 Delivery and bounces' : l)));
    assert.deepEqual(
      issuesOf(files, 12).map((x) => `${x.file}: ${x.message}`),
      ['README.md: the index is out of date', '2.1.md: the breadcrumb is out of date', '2.2.md: the breadcrumb is out of date'],
    );
    const res = D.fixDoc(files, ctx(12));
    assert.deepEqual(res.actions, ['updated 2 breadcrumbs', 'regenerated the index']);
    assert.deepEqual([...res.files.keys()].sort(), names);
    assert.equal(res.files.get('2.2.md')[0], '> [SDD001 — Mail](README.md) › [§2 Delivery and bounces](2.md)');
  });

  test('a section written just above the index does not carry the index away when it moves', () => {
    const input = only([
      ...readme('SDD001', 'A'),
      ...section('1', 'One', body('one', 4)),
      ...section('2', 'Two', body('two', 4)),
      D.INDEX_OPEN,
      '- §1 One',
      '- §2 Two',
      D.INDEX_CLOSE,
    ]);
    const res = D.fixDoc(input, ctx(12));
    assert.deepEqual(res.files.get('2.md').slice(2), ['## §2 Two', '', ...body('two', 4)]);
    assert.deepEqual(res.files.get(README).slice(-4), [D.INDEX_OPEN, '- [§1 One](1.md)', '- [§2 Two](2.md)', D.INDEX_CLOSE]);
  });

  test('a section over the limit with no subsections is reported, not cut', () => {
    const res = D.fixDoc(only(readme('SDD001', 'A', section('1', 'Long', body('long', 30)))), ctx(20));
    assert.deepEqual(messages(issuesOf(res.files, 20)), [
      '1.md: 34 lines, over the 20-line limit, and §1 has no subsections to move out: divide it into nested sections (§1.1, §1.2, …), then run fix',
    ]);
  });

  test('heading levels follow section depth', () => {
    const res = D.fixDoc(only(readme('SDD001', 'A', ['### §1 Too deep', '', 'x', '', '## §1.1 Too shallow', '', 'y'])), ctx());
    assert.equal(res.actions[0], 'set 2 heading levels from section depth');
    assert.ok(res.files.get(README).includes('## §1 Too deep'));
    assert.ok(res.files.get(README).includes('### §1.1 Too shallow'));
  });

  test('a hand-written index gives way to the generated one; the break that closed it stays', () => {
    const input = only(readme('SDD001', 'A', ['## Index', '', '- **§1 Overview**', '', '---', '', ...section('1', 'Overview')]));
    assert.deepEqual(D.fixDoc(input, ctx()).files.get(README).slice(4), [
      '## Index',
      '',
      D.INDEX_OPEN,
      '- §1 Overview',
      D.INDEX_CLOSE,
      '',
      '---',
      '',
      '## §1 Overview',
      '',
      '§1 line 1.',
      '',
    ]);
  });

  test('text under a hand-written index is kept, after the generated block', () => {
    const input = only(
      readme('SDD001', 'A', [...section('1', 'Overview'), '## Index', '', '- **§1 Overview**', '', '', 'A closing remark.', '', 'And another.', '']),
    );
    const res = D.fixDoc(input, ctx());
    const out = res.files.get(README);
    assert.deepEqual(out.slice(out.indexOf('## Index')), [
      '## Index',
      '',
      D.INDEX_OPEN,
      '- §1 Overview',
      D.INDEX_CLOSE,
      '',
      'A closing remark.',
      '',
      'And another.',
    ]);
    assert.deepEqual(D.fixDoc(res.files, ctx()).actions, []);
  });

  test('a title not yet in the SDD form names the doc by its id in the breadcrumb, so fix is not blocked later', () => {
    const input = only(['# Mail, no id yet', '', 'What it covers.', '', ...section('1', 'Overview', body('one', 3)), ...section('2', 'Delivery', body('two', 3))]);
    const res = D.fixDoc(input, ctx(12));
    assert.equal(res.blocked, null);
    assert.equal(res.files.get('2.md')[0], '> [SDD001](README.md)');
    const after = issuesOf(res.files, 12);
    assert.ok(!after.some((x) => x.structural), messages(after).join('\n'));

    res.files.set(README, res.files.get(README).map((l) => (l === '# Mail, no id yet' ? '# SDD001 — Mail' : l)));
    const again = D.fixDoc(res.files, ctx(12));
    assert.equal(again.blocked, null);
    assert.deepEqual(again.actions, ['updated 2 breadcrumbs']);
    assert.equal(again.files.get('2.md')[0], '> [SDD001 — Mail](README.md)');
    assert.deepEqual(issuesOf(again.files, 12), []);
  });

  // Generated docs, every shape fix meets: nesting four deep, a code fence holding a fake section
  // heading, an unnumbered note heading inside a section, thematic breaks between sections. At
  // each limit fix must keep every line of text in order, leave nothing it could still repair,
  // leave no file over the limit that it could have split, and change nothing when run again —
  // splitting a doc that is one file, and merging back a doc already split, once the limit is
  // raised or its text cut.
  function generated(seed) {
    const rnd = prng(seed);
    const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const lines = readme('SDD001', `Generated ${seed}`);
    const walk = (prefix, depth) => {
      const count = depth === 1 ? int(2, 6) : depth >= 4 ? 0 : int(0, 4);
      for (let k = 1; k <= count; k++) {
        const anchor = prefix ? `${prefix}.${k}` : `${k}`;
        const text = body(`§${anchor}`, int(1, 12));
        if (rnd() < 0.2) text.push('', '```md', `## §9${anchor} a heading inside a fence`, '```');
        if (rnd() < 0.2) text.push('', `###### A note in §${anchor}`, '', `Note for §${anchor}.`);
        lines.push(...section(anchor, `Title ${anchor}`, text));
        if (rnd() < 0.3) lines.push('---', '');
        walk(anchor, depth + 1);
      }
    };
    walk('', 1);
    return only(lines);
  }

  // The doc with every section's text cut to its first line.
  const shrink = (files) => new Map([...files].map(([name, lines]) => [name, lines.filter((l) => !/^§[\d.]+ line (?:[2-9]|\d{2,})\.$/.test(l))]));

  function settled(input, max, what) {
    const res = D.fixDoc(input, ctx(max));
    assert.equal(res.blocked, null, what);
    assert.deepEqual(prose(res.files), prose(input), `text changed: ${what}`);
    const after = issuesOf(res.files, max);
    assert.deepEqual(messages(after.filter((x) => x.fixable || x.structural)), [], what);
    for (const [name, lines] of res.files) {
      if (lines.length <= max) continue;
      assert.ok(
        after.some((x) => x.file === name && /no (subsections|sections left) to move out/.test(x.message)),
        `${name} is ${lines.length} lines with nothing reported: ${what}`,
      );
    }
    const again = D.fixDoc(res.files, ctx(max));
    assert.deepEqual(again.actions, [], `second run: ${what}`);
    assert.deepEqual([...again.files], [...res.files], `second run: ${what}`);
    return res;
  }

  for (let seed = 1; seed <= 25; seed++) {
    test(`generated doc ${seed}: text kept, rules met, a second run changes nothing`, () => {
      const input = generated(seed);
      for (const max of [8, 15, 30, 60, 1000]) {
        const res = settled(input, max, `split at maxLines ${max}`);
        settled(res.files, max * 4, `split at ${max}, then fixed at ${max * 4}`);
        settled(shrink(res.files), max, `split at ${max}, then text cut`);
      }
    });
  }

  test('generated docs: when the whole doc fits within two-thirds of the limit, it folds back into README.md alone', () => {
    let merges = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const input = generated(seed);
      const split = D.fixDoc(input, ctx(8)).files;
      const joined = D.fixDoc(input, ctx(1e6)).files.get(README).length;
      const res = D.fixDoc(split, ctx(Math.ceil(joined * 1.5) + 3));
      assert.deepEqual([...res.files.keys()], [README], `seed ${seed}`);
      assert.deepEqual(prose(res.files), prose(input), `seed ${seed}`);
      merges += res.actions.filter((a) => a.startsWith('merged')).length;
    }
    assert.ok(merges > 25);
  });
});

describe('references', () => {
  const kinds = (line, opts) => D.findRefs(line, opts).map((r) => `${r.kind}:${r.num ?? '-'}:${r.anchor ?? (r.tag ? `#${r.tag}` : '-')}`);

  test('full, whole-doc and non-canonical', () => {
    assert.deepEqual(kinds('see SDD011§3.2 and SDD004, not SDD11§1'), ['full:11:3.2', 'full:4:-', 'noncanonical:11:1']);
  });

  test('an identifier or a hash that happens to contain an id is not a reference', () => {
    assert.deepEqual(kinds('const SDD001_FLAG = 1; hash=/SDD12abc; SDD003x; §1 of SDD004y'), []);
    assert.deepEqual(kinds('(SDD001) SDD002. SDD003§1, SDD004§2.'), ['full:1:-', 'full:2:-', 'full:3:1', 'full:4:2']);
  });

  test('a short form borrows the doc before it, after a slash or a comma', () => {
    assert.deepEqual(kinds('(SDD006§2.4.1/§12) and SDD013§2.2.4, §5.2.1.1'), [
      'full:6:2.4.1',
      'short:6:12',
      'full:13:2.2.4',
      'short:13:5.2.1.1',
    ]);
  });

  test('prose: §8.1.2 of SDD006', () => {
    assert.deepEqual(kinds('exists because §8.1.2 of SDD006 says so'), ['prose:6:8.1.2']);
  });

  test('a markdown link into an SDD, by file or by folder, with the anchor written after it', () => {
    assert.deepEqual(kinds('[SDD007](SDD007-seo.md)§4.4.1 and [notes](../sdd/SDD002-mail/3.md)', { markdown: true }), [
      'link:7:4.4.1',
      'link:2:-',
    ]);
  });

  test('a link to the folder itself, or one carrying a title, is a link too', () => {
    assert.deepEqual(kinds('[x](../sdd/SDD002-mail) and [y](../sdd/SDD002-mail/3.md "Mail")§1', { markdown: true }), [
      'link:2:-',
      'link:2:1',
    ]);
  });

  test('a bare § is a reference only inside an SDD’s own files', () => {
    assert.deepEqual(kinds('as §3.2 says'), []);
    assert.deepEqual(kinds('as §3.2 says', { bare: true }), ['bare:-:3.2']);
  });

  test('in an SDD file, headings, the breadcrumb and fenced code define anchors rather than cite them', () => {
    const lines = ['> [SDD001 — A](README.md) › [§1 One](1.md)', '', '### §1.2 Two', '', 'see §1.1 and SDD002§4', '```', 'SDD404§1', '```'];
    const refs = D.refsInFile('1.2.md', lines, { markdown: true, inDoc: true });
    assert.deepEqual(refs.map((r) => `${r.i}:${r.kind}:${r.anchor}`), ['4:bare:1.1', '4:full:4']);
  });

  test('each reference is checked against the docs', () => {
    const own = {
      id: 'SDD001',
      model: D.buildModel(only([...readme('SDD001', 'A'), ...section('1', 'One'), ...section('2', '(removed; see §1)')])),
    };
    const docs = new Map([[1, [own]]]);
    const check = (line, opts) => D.findRefs(line, opts).map((r) => D.validateRef(r, docs, own));
    assert.deepEqual(check('SDD001§1'), [null]);
    assert.deepEqual(check('SDD001§9'), [{ level: 'error', message: 'SDD001 has no §9' }]);
    assert.deepEqual(check('SDD002'), [{ level: 'error', message: 'SDD002 does not exist' }]);
    assert.deepEqual(check('SDD001§2'), [{ level: 'warning', message: 'SDD001§2 was removed: (removed; see §1)' }]);
    assert.deepEqual(check('§9', { bare: true }), [{ level: 'error', message: 'no §9 in SDD001' }]);
    assert.deepEqual(check('SDD01§1'), [{ level: 'error', message: 'write SDD001, not SDD01' }]);
  });

  test('a label where a number belongs is caught; a lowercase placeholder is not a reference to check', () => {
    assert.deepEqual(kinds('SDD013§P6. SDD006§03 and SDD014§x.y'), ['full:13:#P6', 'full:6:#03', 'full:14:-']);
    assert.deepEqual(kinds('outside §P6, see §x.y', { bare: true }), ['bare:-:#P6']);
  });

  test('a short form reads past labels, and/or, ranges, and parentheses after a bare id', () => {
    assert.deepEqual(kinds('SDD005§8.6 (dialog), §8.2 (sanitize), §9 (price)'), ['full:5:8.6', 'short:5:8.2', 'short:5:9']);
    assert.deepEqual(kinds('both SDD013§4.2 and §5.1, or §5.3; SDD017§6.1–§6.2'), [
      'full:13:4.2',
      'short:13:5.1',
      'short:13:5.3',
      'full:17:6.1',
      'short:17:6.2',
    ]);
    assert.deepEqual(kinds('SDD001 (esp. §7 checkout, §8 orders) and SDD004 (`names`, §7/§10)'), [
      'full:1:-',
      'short:1:7',
      'short:1:8',
      'full:4:-',
      'short:4:7',
      'short:4:10',
    ]);
    assert.deepEqual(kinds('admin merge (SDD013§P4/§P5/§5.3.1)'), ['full:13:#P4', 'short:13:#P5', 'short:13:5.3.1']);
  });

  test('parentheses holding a § after a list item are the host doc’s, and end the list', () => {
    assert.deepEqual(kinds('SDD013§2.2.5/§2.2.6 (§4.9, §6.2.2), §7', { bare: true }), [
      'full:13:2.2.5',
      'short:13:2.2.6',
      'bare:-:4.9',
      'bare:-:6.2.2',
      'bare:-:7',
    ]);
  });

  test('a § after a space belongs to the id before it; after an all-caps name or a number, to another document', () => {
    assert.deepEqual(kinds('cached (SDD007 §8, §9), see §2', { bare: true }), ['full:7:-', 'short:7:8', 'short:7:9', 'bare:-:2']);
    assert.deepEqual(kinds('per RFC 6265 §5.3 and GDPR §17; SDD001§2 (see RFC 9110 §15)', { bare: true }), ['full:1:2']);
  });

  test('a list item followed by "of SDDnnn" is that doc’s, not the list’s', () => {
    assert.deepEqual(kinds('SDD001§1 and §2 of SDD002'), ['full:1:1', 'prose:2:2']);
  });

  test('a label is reported with the headings that carry it', () => {
    const model = D.buildModel(
      only([...readme('SDD013', 'A'), ...section('1', 'Sellers (§P1)'), ...section('2', 'Offers (§P6)'), ...section('3', 'Cart (§P6, §P7)')]),
    );
    const docs = new Map([[13, [{ id: 'SDD013', model }]]]);
    const check = (line) => D.findRefs(line).map((r) => D.validateRef(r, docs, null).message);
    assert.deepEqual(check('SDD013§P1'), ['"§P1" is not a section number; the one heading in SDD013 that carries it is §1']);
    assert.deepEqual(check('SDD013§P6'), ['"§P6" is not a section number; the headings in SDD013 that carry it: §2, §3']);
    assert.deepEqual(check('SDD013§P9'), ['"§P9" is not a section number, and no heading in SDD013 carries it']);
    assert.deepEqual(check('SDD099§P1'), ['SDD099 does not exist']);
  });

  test('a label counts only where a heading carries it bare; failing that, the docs whose headings do are named', () => {
    const sdd013 = D.buildModel(only([...readme('SDD013', 'A'), ...section('1', 'Sellers (§P1)'), ...section('2', 'Offers (§P6)')]));
    const sdd002 = D.buildModel(only([...readme('SDD002', 'B'), ...section('1', 'Checkout (SDD013§P6)')]));
    const own = { id: 'SDD002', model: sdd002 };
    const docs = new Map([[2, [own]], [13, [{ id: 'SDD013', model: sdd013 }]]]);
    const check = (line) => D.findRefs(line, { bare: true }).map((r) => D.validateRef(r, docs, own).message);
    assert.deepEqual(check('since §P6'), ['"§P6" is not a section number; no heading in SDD002 carries it, but these do: SDD013 (§2)']);
    assert.deepEqual(check('since §P9'), ['"§P9" is not a section number, and no heading in SDD002 carries it']);
  });

  test('a section title is read for what it cites; a bare label in it is where the label is defined', () => {
    const lines = ['### §1.2 Checkout (SDD013§P6) as landed (§P6), see §1.1', ''];
    const refs = D.refsInFile('1.md', lines, { markdown: true, inDoc: true });
    assert.deepEqual(refs.map((r) => `${r.kind}:${r.anchor ?? `#${r.tag}`}`), ['full:#P6', 'bare:1.1']);
  });

  test('a section written after a link, with or without a space, is the link’s', () => {
    assert.deepEqual(kinds('[SDD007](SDD007-seo.md) §4.4.1 and §2', { markdown: true, bare: true }), ['link:7:4.4.1', 'bare:-:2']);
  });

  test('migration writes every reference in the full form, a list joined by commas', () => {
    assert.deepEqual(D.expandRefs('(SDD006§2.4.1/§12), SDD013§2.2.4, §5.2.1.1; §8.1.2 of SDD006'), {
      line: '(SDD006§2.4.1, SDD006§12), SDD013§2.2.4, SDD013§5.2.1.1; SDD006§8.1.2',
      count: 3,
    });
    const expand = (line) => D.expandRefs(line).line;
    assert.equal(expand('SDD005§8.6 (dialog), §8.2 (sanitize)'), 'SDD005§8.6 (dialog), SDD005§8.2 (sanitize)');
    assert.equal(expand('SDD013§4.2 and §5.1; SDD017§6.1–§6.2'), 'SDD013§4.2 and SDD013§5.1; SDD017§6.1–SDD017§6.2');
    assert.equal(expand('SDD001 (esp. §7, §8) and SDD004 (`x`, §7 / §10)'), 'SDD001 (esp. SDD001§7, SDD001§8) and SDD004 (`x`, SDD004§7, SDD004§10)');
    assert.equal(expand('(SDD007 §4.2/§4.3), RFC 6265 §5.3'), '(SDD007§4.2, SDD007§4.3), RFC 6265 §5.3');
    assert.equal(expand('SDD013§P4/§P5/§5.3.1'), 'SDD013§P4, SDD013§P5, SDD013§5.3.1');
    assert.equal(expand('SDD002§8/SDD003§4.7, SDD014§x.y'), 'SDD002§8/SDD003§4.7, SDD014§x.y');
  });

  test('a link with the section inside its text or after a space comes out in the full form', () => {
    const migrate = (line) => D.expandRefs(D.rewriteDocLinks(line, (base) => ({ 'SDD014-abac.md': 'SDD014' })[base]).line).line;
    assert.equal(migrate('in **[SDD014 §5](../sdd/SDD014-abac.md)**'), 'in **SDD014§5**');
    assert.equal(migrate('[SDD014](SDD014-abac.md) §3.1/§3.2'), 'SDD014§3.1, SDD014§3.2');
    assert.equal(migrate('in **[SDD014 — ABAC](../sdd/SDD014-abac.md) §4**: the guard'), 'in **SDD014 — ABAC (SDD014§4)**: the guard');
  });

  test('migration turns links to single-file SDDs into ids', () => {
    const rewrite = (line) => D.rewriteDocLinks(line, (base) => ({ 'SDD006-order-workflow.md': 'SDD006' })[base]).line;
    assert.equal(rewrite('[SDD006](SDD006-order-workflow.md)§3.1'), 'SDD006§3.1');
    assert.equal(rewrite('[order workflow](../sdd/SDD006-order-workflow.md)'), 'order workflow (SDD006)');
    assert.equal(rewrite('[order workflow](SDD006-order-workflow.md#31-x)§3.1'), 'order workflow (SDD006§3.1)');
    assert.equal(rewrite('[SDD006 — Order workflow](SDD006-order-workflow.md)'), 'SDD006 — Order workflow');
    assert.equal(rewrite('see [ SDD006 — Order workflow ](SDD006-order-workflow.md) here'), 'see SDD006 — Order workflow here');
    assert.equal(rewrite('[x](SDD006-order-workflow.md?v=1 "Orders")'), 'x (SDD006)');
    assert.equal(rewrite('[other](SDD007-x.md)'), '[other](SDD007-x.md)');
  });
});
