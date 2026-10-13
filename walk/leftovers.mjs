// After a live walk: no scratch element may remain. Run with the same env as live-write.mjs.
import './guard.mjs';
import { OwV2Client } from '@onlyworlds/sdk';
const api = new OwV2Client({ apiKey: process.env.OW_WRITE_KEY ?? process.env.OW_DEMO_WRITE_KEY });
const left = [];
for (const q of ['Lantern probe', 'Mine: the phone', 'Theirs: another hand', 'A page, ']) {
  const page = await api.list('narrative', { filter: { name__icontains: q } });
  left.push(...page.data.map((e) => `${e.name} (${e.id})`));
}
const unsorted = await api.list('narrative', { filter: { supertype: 'Unsorted' } });
left.push(...unsorted.data.map((e) => `Unsorted: ${e.name} (${e.id})`));
console.log(left.length ? `LEFT BEHIND:\n${[...new Set(left)].join('\n')}` : 'nothing left behind');
