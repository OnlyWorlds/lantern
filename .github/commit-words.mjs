#!/usr/bin/env node
// A commit message is published text: the messages a push or pull request adds point at no room or
// tracker the public cannot read, and name no one inside the team (a person named is Titus, the
// founder). The rows are the npm SDK's (OnlyWorlds/sdk scripts/public-words.mjs). No dependencies.
//
//   node commit-words.mjs A..B   the commits B adds to A
//   node commit-words.mjs SHA    one commit
//
// Exit 0 clean, 1 on a finding, 2 when git cannot read the commits (a shallow clone, a commit gone).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const PATTERNS = [
  [/\bh[0-9]{1,3} #[0-9]+/g, 'the date of the ruling'],
  [/\bh[0-9]{1,3}(?= [0-9]{4}-[0-9]{2}-[0-9]{2})/g, 'the date alone'],
  [/\b(?:[Kk]eel|OW [A-Z][a-z]+) #[0-9]+/g, 'the date, or what changed'],
  [/(?<![\w/.&-])#[0-9]{4,5}\b/g, 'the date of the ruling'],
  [/\bD[0-9]{2,3}[a-z]?\b/g, 'nothing: an internal decision id'],
  [/[A-Za-z]:[/\\]Users[/\\]/g, "nothing: a path on a maintainer's machine"],
];

// The team's own words, as the first 12 hex of each word's sha256, so this file does not publish what
// it refuses: one word, or "the" and a word.
const WORDS = new Map([
  ['2e786c488b83', 'Titus, or the founder'],
  ['9dd2ca99ffc9', 'nothing: an internal surface'],
  ['271c535631ff', 'nothing: an internal surface'],
  ['4340fc2d9418', 'nothing: an internal mailbox'],
  ...['d97084040035', 'b372644b8fec', '0c6874e447ef', '66ada4d485d7', '3892e10346fd', '8899ecd1626d',
    '44e7d4b24846', '0aa91af2ec4c'].map((h) => [h, 'nothing, or the thing described plainly: a team folder']),
  ...['7d07b8e5c49d', '0ced2c75df2d', '9c2a44c4716d', 'd3aaf0e63f73', '9067ae5c5374', 'fdfd7512f532',
    'fbee9d8f57c5', '6a6ac8386005', 'd5ef0f0e059a', 'c62063d665f3', '06110f3dd13d'].map((h) => [h, 'nothing, Titus, or the maintainers']),
]);
const hash = (w) => createHash('sha256').update(w).digest('hex').slice(0, 12);

const spec = process.argv[2];
if (!spec) { console.log('commit words: give a range (A..B) or one commit'); process.exit(2); }
let log;
try {
  const args = spec.includes('..') ? [spec] : ['-1', spec];
  log = execFileSync('git', ['log', '--format=%h%x00%B%x01', ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
} catch {
  console.log(`commit words: git could not read the commits ${spec} (a shallow clone, or a commit gone); not a pass`);
  process.exit(2);
}
const commits = log.split('\x01').map((c) => c.trim()).filter(Boolean);
const found = [];
for (const c of commits) {
  const [sha, message = ''] = c.split('\0');
  message.split(/\r?\n/).forEach((line, i) => {
    let prev = null;
    let prevEnd = -1;
    for (const m of line.matchAll(/[A-Za-z][A-Za-z0-9]*/g)) {
      const words = [m[0]];
      if (prev === 'the' && line.slice(prevEnd, m.index) === ' ') words.push(`the ${m[0]}`);
      for (const w of words) {
        const instead = WORDS.get(hash(w));
        if (instead) found.push(`commit ${sha}:${i + 1}: '${w}' (write ${instead})`);
      }
      prev = m[0];
      prevEnd = m.index + m[0].length;
    }
    const taken = [];
    for (const [pat, instead] of PATTERNS) {
      for (const m of line.matchAll(pat)) {
        if (taken.some(([a, b]) => a <= m.index && m.index < b)) continue;
        taken.push([m.index, m.index + m[0].length]);
        found.push(`commit ${sha}:${i + 1}: '${m[0]}' (write ${instead})`);
      }
    }
  });
}
for (const line of found) console.log(line);
console.log(`commit words: ${found.length} finding(s) in ${commits.length} commit message(s)`);
process.exit(found.length ? 1 : 0);
