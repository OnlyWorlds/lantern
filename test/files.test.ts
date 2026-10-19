import { describe, expect, it } from 'vitest';
import type { OwFileRow } from '@onlyworlds/sdk';
import { fileLine, fileSize } from '../src/files';

const row = (over: Partial<OwFileRow> = {}): OwFileRow => ({
  id: 'f1', name: 'scan.pdf', kind: 'pdf', size: 12.4 * 1024 * 1024, label: 'Source',
  added_by: { name: 'crew-walk-a', membership: null, agent: false }, added_at: '2026-10-19T12:00:00Z', ...over,
});

describe('a file on the page', () => {
  it('reads as Atlas reads it', () => {
    expect(fileLine(row())).toBe('pdf · 12.4 MB · added by crew-walk-a · 2026-10-19');
    expect(fileSize(6 * 1024)).toBe('6 KB');
    expect(fileSize(300)).toBe('300 bytes');
  });
  it('a missing adder still reads', () => {
    expect(fileLine(row({ added_by: undefined as unknown as OwFileRow['added_by'] }))).toContain('added by someone');
  });
});
