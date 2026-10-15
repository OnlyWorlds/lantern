// #347: the quiet mark reads keel's door of the last write (#299). Agent-made is seat, mcp or
// declared; every other door, and none, is a person's (or unknown) and says nothing.
import { describe, it, expect } from 'vitest';
import type { OwMember } from '@onlyworlds/sdk';
import { agentLine } from '../src/agentmark';

const SEAT = 'b1c2d3e4-0000-4000-8000-000000000001';
const CHAR = 'c1c2d3e4-0000-4000-8000-000000000002';
const roster: OwMember[] = [
  { id: null, kind: 'owner', role: 'owner', character: null, status: 'active' },
  { id: SEAT, kind: 'agent', role: 'contributor', character: CHAR, status: 'active', name: 'Skeld' },
];
const names = (id: string) => (id === CHAR ? 'The Boatswain' : undefined);

describe('agentLine', () => {
  it('a person\'s door, or none, says nothing', () => {
    for (const via of ['api', 'v1', 'sync', 'server', null, undefined, 7]) {
      expect(agentLine({ changed_via: via, changed_by: SEAT }, roster, names)).toBeNull();
    }
    expect(agentLine({}, roster, names)).toBeNull();
  });

  it('an agent seat is named from the roster, else by its Character, else not at all', () => {
    expect(agentLine({ changed_via: 'seat', changed_by: SEAT }, roster, names)).toBe('Last changed by Skeld, an agent');
    expect(agentLine({ changed_via: 'seat', changed_by: SEAT }, [{ ...roster[1], name: undefined }], names))
      .toBe('Last changed by The Boatswain, an agent');
    expect(agentLine({ changed_via: 'seat', changed_by: SEAT }, null, names)).toBe('Last changed by an agent');
    expect(agentLine({ changed_via: 'seat', changed_by: 'x' }, roster, names)).toBe('Last changed by an agent');
  });

  it('MCP and a declared client say their door, never a person\'s name', () => {
    expect(agentLine({ changed_via: 'mcp', changed_by: null }, roster, names)).toBe('Last changed by an agent, through MCP');
    expect(agentLine({ changed_via: 'declared', changed_by: SEAT }, roster, names)).toBe('Last changed by an agent (the tool said so)');
  });
});
