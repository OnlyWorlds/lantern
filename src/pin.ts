// The PIN. keel keeps one per account and copies it onto every world the account owns (Skeld,
// h37 #3674), so every world from your account shares one slot here; a world opened with someone
// else's key keeps its own. Kept on this phone for good (the Captain, #3675: "the most permanent
// storage that is still safe"): it sits beside the account token and the world keys, and anyone
// who can read this phone's storage can read those too, so keeping it adds no new exposure. That
// holds while the CSP's script-src stays 'self': an injected script could read the token, the keys
// and the PIN together, so loosening scripts is the moment to weigh this again (Boss #3741). It is
// cleared on a wrong try (keel refused it), on sign-out (the account's), and when a world leaves
// the phone (that world's own).
export type PinOwner = { id: string; role?: string };

const ACCOUNT_PIN = 'lantern-pin-account';
const pinKey = (w: PinOwner) => (w.role ? ACCOUNT_PIN : `lantern-pin-${w.id}`);

export function pinFor(w: PinOwner): string | undefined {
  try {
    return localStorage.getItem(pinKey(w)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setPin(w: PinOwner, pin: string | undefined): void {
  try {
    if (pin) localStorage.setItem(pinKey(w), pin);
    else localStorage.removeItem(pinKey(w));
  } catch {
    /* storage refused: the PIN is asked again next time */
  }
}

/** Sign-out: the account's PIN is not the next account's. */
export function forgetAccountPin(): void {
  setPin({ id: '', role: 'owner' }, undefined);
}
