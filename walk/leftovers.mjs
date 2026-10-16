// After a live walk: no scratch element may remain. Run with the same env as live-write.mjs.
import './guard.mjs';
import { readFileSync } from 'node:fs';
import { OwV2Client } from '@onlyworlds/sdk';
import { WRITE_WORLD_KEY } from './live-world.mjs';
// W11's key is a ten-digit one, so its reads need the PIN too.
const api = new OwV2Client({ apiKey: process.env.OW_WRITE_KEY ?? WRITE_WORLD_KEY, apiPin: readFileSync(process.env.OW_PIN_FILE, 'utf8').trim() });
const left = [];
for (const q of ['Lantern probe', 'Mine: the phone', 'Theirs: another hand', 'A page, ']) {
  const page = await api.list('narrative', { filter: { name__icontains: q } });
  left.push(...page.data.map((e) => `${e.name} (${e.id})`));
}
// The agent mark's probes (walk/live-agentmark.mjs, Atlas's S415 live walk) are Characters.
const probes = await api.list('character', { filter: { name__icontains: 'Agent mark probe' } });
left.push(...probes.data.map((e) => `${e.name} (${e.id})`));
const unsorted = await api.list('narrative', { filter: { supertype: 'Unsorted' } });
left.push(...unsorted.data.map((e) => `Unsorted: ${e.name} (${e.id})`));
console.log(left.length ? `LEFT BEHIND:\n${[...new Set(left)].join('\n')}` : 'nothing left behind');
