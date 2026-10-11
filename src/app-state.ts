// App-wide state: the look, the build, and whether a newer build is waiting.
import { setBuildBehind } from './world';

declare const __BUILD_ID__: string;
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

export type Theme = 'warm' | 'house';

export function currentTheme(): Theme {
  try {
    return localStorage.getItem('lantern-theme') === 'house' ? 'house' : 'warm';
  } catch {
    return 'warm';
  }
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('lantern-theme', t);
  } catch {
    /* the look falls back to warm next time */
  }
}

/**
 * A pinned phone can run an old build for days. On open (and when the app comes back to the
 * front), ask the server which build is current, bypassing every cache; while this build is
 * behind, the outbox holds and the screen offers the reload (Boss #3391).
 */
export async function checkForUpdate(onBehind: () => void): Promise<void> {
  if (BUILD_ID === 'dev' || !navigator.onLine) return;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = (await res.json()) as { build?: string };
    if (build && build !== BUILD_ID) {
      setBuildBehind(true);
      onBehind();
    }
  } catch {
    /* offline: this build carries on */
  }
}
