/**
 * The quiet agent mark (#347; the agents page §10:
 * a fact about the record, derived on read, in the tool's chrome). keel records the door of every
 * element write (#299): `changed_via` is seat (an agent seat), mcp, declared (a client that said
 * it is an agent), or a person's surface (api, v1, sync, server); `changed_by` the membership.
 * Agent-made is the SDK's `isAgentDoor`. Lantern never declares itself one (Kael's stitches guard).
 * It describes keel's LAST write: while an edit of mine waits, the page shows my values and no mark;
 * once it lands, keel's answer carries Lantern's own door. Atlas says the same lines.
 */
import { isAgentDoor, type OwMember, type OwWriteDoor } from '@onlyworlds/sdk';

export function agentLine(
  el: Record<string, unknown>,
  roster: readonly OwMember[] | null,
  nameOf: (id: string) => string | undefined,
): string | null {
  const via = el.changed_via;
  if (typeof via !== 'string' || !isAgentDoor(via as OwWriteDoor)) return null;
  const by = typeof el.changed_by === 'string' ? el.changed_by : null;
  const who = via === 'seat' ? seatName(by, roster, nameOf) : null;
  if (who) return `Last changed by ${who}, an agent`;
  if (via === 'mcp') return 'Last changed by an agent, through MCP';
  if (via === 'declared') return 'Last changed by an agent (the tool said so)';
  return 'Last changed by an agent';
}

/** An agent seat's name: the roster's own, else its Character's, else none. */
function seatName(
  membership: string | null,
  roster: readonly OwMember[] | null,
  nameOf: (id: string) => string | undefined,
): string | null {
  if (!membership || !roster) return null;
  const row = roster.find((m) => m.id === membership);
  if (!row) return null;
  const own = typeof row.name === 'string' ? row.name.trim() : '';
  if (own) return own;
  const character = row.character ? nameOf(row.character)?.trim() : '';
  return character || null;
}
