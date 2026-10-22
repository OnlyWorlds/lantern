// keel #520: every write names the app that made it. Lantern writes through the SDK, whose `client`
// option (4.56.0, default 'sdk') sends X-OW-Client on element writes. A census of the source: every
// OwV2Client Lantern builds passes LANTERN_CLIENT_NAME, so a new one cannot arrive unnamed.
import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { LANTERN_CLIENT_NAME } from '../src/world';

describe('the client name (keel #520)', () => {
  it('is a name keel takes: lower case, digits and hyphens, 1 to 32', () => {
    expect(LANTERN_CLIENT_NAME).toMatch(/^[a-z0-9-]{1,32}$/);
  });

  it('every OwV2Client Lantern builds passes it', () => {
    const sites: string[] = [];
    for (const f of globSync('src/**/*.ts')) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/new OwV2Client\(/g)) {
        let depth = 0;
        let end = m.index! + 'new OwV2Client'.length;
        for (; end < text.length; end++) {
          if (text[end] === '(') depth++;
          else if (text[end] === ')' && --depth === 0) break;
        }
        sites.push(`${f}: ${/client: LANTERN_CLIENT_NAME/.test(text.slice(m.index!, end + 1)) ? 'named' : 'UNNAMED'}`);
      }
    }
    expect(sites.length).toBeGreaterThanOrEqual(16);
    expect(sites.filter((s) => s.endsWith('UNNAMED'))).toEqual([]);
  });
});
