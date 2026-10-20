// Add to the home screen, as a button that does something (the Captain's walk, 2026-10-12: it was a
// sentence that looked like one). Where the browser offers its own install dialog (Chrome and Edge
// on Android, beforeinstallprompt), the button opens it; elsewhere it says the steps (an iPhone has
// no dialog a page can open: Share, then Add to Home Screen).
import { h } from './dom';
import { icon } from './icons';
import { isStandalone, sheet, toast } from './ui';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let offered: InstallPromptEvent | null = null;
let installed = false;

// Kept from the first moment: the browser fires it once, early, and again only after a while.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  offered = e as InstallPromptEvent;
});
window.addEventListener('appinstalled', () => {
  offered = null;
  installed = true;
});

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isAndroid(): boolean {
  return /Android/.test(navigator.userAgent);
}

/** Already on the home screen (opened from it), or added in this visit. */
export function onHomeScreen(): boolean {
  return installed || isStandalone();
}

function stepsSheet(): void {
  const steps = isIos()
    ? ['Tap the Share button at the bottom of Safari (a square with an arrow).', 'Choose Add to Home Screen, then Add.']
    : isAndroid()
      ? ['Open the browser menu (the three dots, top right).', 'Choose Add to Home screen, or Install app.']
      : ['Open the browser menu, or the install mark at the end of the address bar.', 'Choose Install, or Add to Home screen.'];
  sheet(
    (close) => {
      const ok = h('button', { class: 'btn btn-standard', type: 'button' }, 'Got it');
      ok.addEventListener('click', close);
      return [
        h('h2', null, 'Add Lantern to your home screen'),
        h('ol', { class: 'steps' }, ...steps.map((t) => h('li', null, t))),
        h('p', { class: 'muted small', style: 'margin:0' }, 'Then open Lantern from its icon: it opens without signal, and keeps your worlds.'),
        ok,
      ];
    },
    'Add Lantern to your home screen',
  );
}

export async function addToHomeScreen(): Promise<void> {
  const ev = offered;
  if (!ev) {
    stepsSheet();
    return;
  }
  offered = null; // a prompt can be shown once
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  if (outcome === 'accepted') {
    installed = true;
    document.querySelectorAll('[data-action=install]').forEach((b) => b.remove());
    toast('Lantern is on your home screen. Open it from there.');
  }
}

/** The button, or null when Lantern already runs from the home screen. */
export function installButton(label = 'Add to home screen', cls = 'btn'): HTMLElement | null {
  if (onHomeScreen()) return null;
  const b = h('button', { class: cls, type: 'button', 'data-action': 'install' }, icon('install', 20), label);
  b.addEventListener('click', () => void addToHomeScreen());
  return b;
}
