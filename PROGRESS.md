# Lantern: progress

**2026-10-12 00:40, updated 02:23** · Temper, S394 (the first overnight build) · S395 (maps)

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
| World files | done; Save a copy, Open a world file, Atlas's file names; maps, pins, zones and markers under `spatial/` both ways, Atlas's older `map_id`/`zone_id` read as `map`/`zone` (S395: before, a world file lost its maps) | `src/worldfile.ts` |
| Maps | done S395, read only, Quillon's rules: "Show on map" on a pin, a marker, a zone, a placed element, a Map ("Open the map"), only for a Map with an https picture; Leaflet 1.9.4 CRS.Simple, SVG renderer, clusters past 1,000 pins (markercluster 1.5.3, loaded only then), zoom stops where the picture runs out (one step past the whole view at least), a tap within a finger of a pin opens its card | `src/maps.ts` (the rules), `src/views/map.ts` |

**Instruments**: `walk/join.mjs` (S395, both engines, workers blocked: with one in control Playwright's WebKit does not route the page's requests) · `walk/share.mjs` (S395, both engines: the start URL with shared title, text and url, as Android opens it) · `walk/map.mjs` (S395, both engines, the demo's two maps read from keel, a tap on a pin, the ceiling, 1,200 pins clustered from a world file) · `npm test` (54: the outbox and feed against a fake keel that refuses what keel refuses; world files on the Captain's real folders, an Atlas world's spatial files included; the map rules) · `walk/walk.mjs` (both engines, `.tap()`, airplane mode; `LANTERN_URL` for the preview; offline, Playwright's WebKit here fails every subresource even from the worker, so the worker's offline serving is Chromium's proof) · `walk/live-write.mjs` (the write path on live keel, Hyperion scratch elements, deleted after; `walk/leftovers.mjs` proves it) · `walk/update.mjs` (a newer build). Run walks against `vite preview` (:5181, `appType: 'mpa'` so missing paths 404 as on Pages).

**The S395 gate** (opus, fresh reader, on the maps diff): four confirmed, seven plausible, all fixed. A clustered map's chunk timer outlived a removed map (chunking off); a redraw keyed on counts missed moved pins, and two redraws could overlap (a content key, one drawing at a time); a file with both `map` and `map_id` landed opposite to Atlas; one id in both folders counted twice; buttons that opened an empty view; a failed Leaflet load stuck until reload; width without height stretched the picture; clustered taps; rotation; five-digit colours. Upheld: no XSS, the CSP, the precache, the round trip to Atlas.

## Not built (next, in order)

1. (done S394) **Put it online**: the account world made once (remembered for a retry), phone-held pictures uploaded, one atomic `/bulk` under a remembered Idempotency-Key, read back, then the phone copy removed. Tested on a fake account keel (4 cases, revert-checked); a live walk needs the Captain's account.
2. (player home done S394; S395: the header names the player's own Character, "You play Mira. You see what Mira knows.", from keel's GET /me read once with the world's own key, Skeld #3457; /me also gives the member role to a world opened with a key. The live /me on a guest key is #213's walk: none here) **Give it to the party** (after Keel #213 is live and #212): the reveal Narrative copies the Object's picture and the DM's line (Skeld's ruling, h37 #3432).
3. (done S395) **Maps** (Quillon's rules, `Armature/Notes/2026-10-12-lantern-maps-report.md`).
4. (done S394) Sign in with email and password through Keel #211; the token door stays behind "I have an account token". Walked live only with a wrong password: a real sign-in is the Captain's.
5. Ask through the proxy (#159) for what the local lookup cannot answer (the proxy is parked on the Captain's spend call).
6. (done S395) **Shared from another app** (Android): the manifest's GET share_target opens `/` with title, text and url; one note, each part once; one world that takes changes goes straight to its catch screen, several ask, none says how to get one; the address is cleaned so a reload does not catch it twice. iPhone has no share target for web apps. A real Android with the app installed is the check (Chrome only offers it to an installed app).
7. (done S395) **Join with an invite link** (Keel #212, live 02:00): "I have an invite link" on the first screen, "Join with an invite link" on Your worlds, or the link shared to Lantern from a chat (Android). POST /join/preview shows who invites, to which world, as what, until when; POST /account/join with this phone's account token, then the world opens with its own key and the guest's Character from `roster_character`. Not signed in: the code waits through the sign-in and the invite comes back. pin_required and already_member get their own sentences; an agent's link is named as one. Unit-tested on a fake keel shaped by keel's tests (`test/join.test.ts`); `walk/join.mjs` walks a bad link on live keel and the rest on a routed fake. A good link is the owner's to make: the first real join is the Captain's game-night walk (Skeld: owed to close #212).

## Known gaps (said, not hidden)

- No real phone has run it: WebKit here is Playwright's on Windows. `preparePhoto` on a real iPhone, the home-screen app's separate storage, `persist()` on iOS: the Captain's morning walk.
- Two tabs on one world can both send a row (the loser restores a settled row). One tab is the phone's case.
- Opening a big world file in Playwright's WebKit on Windows: 1,201 elements take 18.6 s, all of it the IndexedDB write (Chromium: 0.1 s). The button says it is opening; whether a real iPhone is that slow is the morning walk's question. A pull of a big world writes the same way.
- A map's picture is not in the worker's precache: it comes from the browser's own cache (media sends a year, immutable), so offline it shows once it has been seen online. A map never opened online says so.
- A share arriving while Lantern is already open: if Android loads it into the open window, a half-typed note there is lost (no launch_handler, no draft kept). Not testable off a phone.
- Pins on the map have no names drawn; a tap names one. Zones are drawn but not tappable.
- A world on this phone keeps a photo as a data URL inside the element; Put it online must upload those first.
