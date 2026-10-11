# Lantern: progress

**2026-10-12 01:10** · Temper, S394 (the first overnight build)

## CURRENT STATE

Built, tested and walked: the spine of DESIGN.md's tonight list. Preview: https://preview.lantern-6nd.pages.dev (Boss flies each announced sha; `lantern.onlyworlds.com` waits for the Captain's yes).

| Piece | State | Where |
|---|---|---|
| Repo, Vite + TS, SDK 4.11 | done | `package.json` (`typecheck`, `build`, `test`) |
| Opens offline (worker) | done; precaches exactly what the build emitted, `/` itself (Pages 308s `/index.html`); shell only for `/`; other paths reach the host's 404 | `sw/sw.js`, `vite.config.ts` |
| Old builds | done; `version.json` checked on open and on return to the front; banner, outbox held, Reload lands the new build | `src/app-state.ts`, `src/main.ts`, `walk/update.mjs` |
| The store | done; IndexedDB, one app db, one per world | `src/db.ts` |
| Reading | done; `/changes` from the cursor, resync into a fresh copy, never regresses a newer copy | `src/world.ts` (`doPull`) |
| Writing, the outbox, conflicts | done; If-Match, per-element order, late base, 412 rule (moved on both sides only), lost answers, 409 on creates, 429/5xx wait | `src/world.ts`, `src/views/outbox.ts` |
| Themes | placeholders under Seethe's tokens until her files land | `src/themes/` |
| Screens | first open (Sign in first), sign in (account token), open with a key, the demo, a new world on this phone, your worlds, settings (warm/house, storage kept?), world home (find, types, Unsorted), type list, element page, edit sheets, catch (text and photo to Unsorted), waiting to send | `src/views/` |
| Ask | done; local only, SDK `lookupWorld`, sources and why, "Your world does not say." | `src/views/ask.ts` |
| World files | done; Save a copy, Open a world file, Atlas's file names | `src/worldfile.ts` |

**Instruments**: `npm test` (26: the outbox and feed against a fake keel that refuses what keel refuses; world files on the Captain's real folder) · `walk/walk.mjs` (both engines, `.tap()`, airplane mode; `LANTERN_URL` for the preview) · `walk/live-write.mjs` (the write path on live keel, Hyperion scratch elements, deleted after; `walk/leftovers.mjs` proves it) · `walk/update.mjs` (a newer build). Run walks against `vite preview` (:5181, `appType: 'mpa'` so missing paths 404 as on Pages).

## Not built (next, in order)

1. **Put it online** (a world on this phone to the account: `POST /account/worlds`, then `/bulk`; a data-URL picture must be uploaded first). Needs an account token to walk; none in Forge.
2. **Give it to the party** (after Keel #213 is live and #212): the reveal Narrative copies the Object's picture and the DM's line (Skeld's ruling, h37 #3432).
3. **Maps** (Quillon's rules, `Armature/Notes/2026-10-12-lantern-maps-report.md`): Leaflet CRS.Simple, one webp overlay, SVG renderer, cluster above 1,000 pins. Only when a map has an online picture.
4. (done S394) Sign in with email and password through Keel #211; the token door stays behind "I have an account token". Walked live only with a wrong password: a real sign-in is the Captain's.
5. Ask through the proxy (#159) for what the local lookup cannot answer.

## Known gaps (said, not hidden)

- No real phone has run it: WebKit here is Playwright's on Windows. `preparePhoto` on a real iPhone, the home-screen app's separate storage, `persist()` on iOS: the Captain's morning walk.
- Two tabs on one world can both send a row (the loser restores a settled row). One tab is the phone's case.
- A world on this phone keeps a photo as a data URL inside the element; Put it online must upload those first.
