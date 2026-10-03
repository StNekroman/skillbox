// Builders for docs in tests: markdown in the shape the doc rules describe.

// n distinct lines, so a test can tell whose text ended up where.
function body(tag, n = 1) {
  return Array.from({ length: n }, (_, i) => `${tag} line ${i + 1}.`);
}

// A section heading at the level its depth takes, its text, and the blank line after.
function section(anchor, title, lines = body(`§${anchor}`)) {
  const level = Math.min(anchor.split('.').length + 1, 6);
  return [`${'#'.repeat(level)} §${anchor} ${title}`, '', ...lines, ''];
}

// The top of a README.md: title and abstract, then whatever follows.
function readme(id, title, rest = [], abstract = `What ${id} covers, in one short paragraph.`) {
  return [`# ${id} — ${title}`, '', abstract, '', ...rest];
}

const text = (lines) => `${lines.join('\n')}\n`;

// Deterministic pseudo-random numbers, so a generated case is the same on every run.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { body, section, readme, text, prng };
