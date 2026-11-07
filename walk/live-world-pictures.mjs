// A world's pictures go with the world: run inside live-ground.mjs, which deletes the world after.
// Uploads a picture on the world's key, sets it on a Character, reads it back on keel only (never at
// the media host, whose edge cache would keep a fetched picture answering after its bytes are gone),
// and writes the picture's address to GROUND_PICTURES_FILE. live-ground.mjs, after the world's delete,
// reads each address once and expects 404.
//   CREW_FILE=... node walk/live-ground.mjs walk/live-world-pictures.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { OwV2Client } from '@onlyworlds/sdk';

const KEY = process.env.OW_WRITE_KEY;
const PIN = readFileSync(process.env.OW_PIN_FILE, 'utf8').trim();
const OUT = process.env.GROUND_PICTURES_FILE;
if (!KEY || !PIN || !OUT) throw new Error('OW_WRITE_KEY, OW_PIN_FILE and GROUND_PICTURES_FILE are needed');
const api = new OwV2Client({ apiKey: KEY, apiPin: PIN });
let failures = 0;
const check = (ok, what) => { console.log(`[pictures] ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

// A 1x1 PNG with a byte of this run in it, so no other upload shares its bytes.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const up = await api.uploadImage(new Blob([png, Buffer.from(String(Date.now()))], { type: 'image/png' }));
check(/^https:\/\/media\.onlyworlds\.com\/u\//.test(String(up.url)), `uploaded on the world's key (${String(up.url).replace(/u\/[0-9a-f-]+\//, 'u/<world>/')})`);
const el = await api.create('character', { name: 'Picture probe', image_url: up.url });
const back = await api.get('character', el.id);
check(back.image_url === up.url, 'keel holds it as the Character\'s picture');
writeFileSync(OUT, `${up.url}\n`);
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
