// Files on an element: how one reads on the page. Files live on OnlyWorlds only,
// never in the phone's copy or /changes; the session asks for them (WorldSession.files).
import type { OwFileRow } from '@onlyworlds/sdk';

/** "12.4 MB", "6 KB", "300 bytes" (Atlas's words for the same files). */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} byte${bytes === 1 ? '' : 's'}`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return mb < 100 ? `${Math.round(mb * 10) / 10} MB` : `${Math.round(mb)} MB`;
}

/** The day it was added, in local time: 2026-10-19. */
function day(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The line under a file's name: kind, size, who added it, the day. */
export function fileLine(row: OwFileRow): string {
  return [row.kind, fileSize(row.size), `added by ${row.added_by?.name || 'someone'}`, day(row.added_at)].filter(Boolean).join(' · ');
}
