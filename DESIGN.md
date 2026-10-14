# Lantern: the build spec

**2026-10-11 23:30** · Temper, S393 · the runway for the first overnight build (h37, the Captain's rulings #3393, #3409, #3413)
**The picture**: the design canvas https://claude.ai/artifact/Cq1bZE99Sy3TKxxB1v1v7V (source `design-canvas/`). **The reasoning**: `Forge/Notes/2026-10-11-lantern-design-questions.md` (D1 to D10) and `Forge/Notes/2026-10-11-lantern-round2.md`. **The first draft with his notes**: `Forge/Notes/2026-10-11-lantern-spec-draft1-annotated.md`.

Lantern is OnlyWorlds in your pocket: a web page pinned to the phone's home screen that holds all your worlds. Find anything, follow its links, fix a field, catch an idea or a page of notes, and run a game from the phone at the table. It works without signal and sends your changes when it can. Atlas is the studio; Lantern is what you carry. Name and address may change later; the address stays `lantern.onlyworlds.com` for now.

---

## Decided (with where)

| What | Ruling | Where |
|---|---|---|
| Frame | OnlyWorlds in your pocket first; the table is its one deep mode. No character sheets, no dice | #3393 on D1 |
| Shape | A world browser: all your worlds, three kinds (online, on this phone only, the demo) | canvas, D2 |
| Account | **Open**: a world can start on the phone with no account; signing in is how a world travels to Atlas or a second device | canvas note, #3393 |
| World control | Lantern edits a world's content, its name, description and picture, its "now" and its units. Keys, members, invites and deleting a world stay on onlyworlds.com | D2, #3393 |
| Players | Members with an account and a Character, invited as guests; they see the world as their Character knows it. **No player is invited before Keel #213 is live** | #3397, #3409 |
| Knowing | Atlas's model: a Narrative is known by its `narrator` and by the members of its `collectives`. `characters` on a Narrative means "about", never "knows". keel learns this (Keel #213) | #3394, #3397 |
| Unsorted | Material not yet turned into elements (a photographed page, a spoken ramble) is a Narrative with supertype `Unsorted`, the photo as its picture. Skeld writes the convention for every tool; Lantern shows it first | #3409, #3411 |
| Conflicts | `If-Match` on element PATCH (Keel #210, live). keel never merges; Lantern re-sends by itself when the fields it touched did not move, and asks "keep mine, take theirs" only when the same field moved on both sides | contract |
| Voice | The keyboard's microphone, everywhere. No stored audio in v1 | Kael #3311 |
| Look | Two themes from day one, **warm** (default) and **house**, each one theme file of colours and fonts; a switch in settings. Seethe owns the theme files. Type chips always from the SDK's `FAMILY_COLORS` | #3409, Seethe #3389 |
| Ask | Lookup and review of what exists only: no inventing, no building, sources shown, "your world does not say" a real answer. The phone's own copy answers first (search, then follow links); a model only for what that walk can't. The model sits behind keel's proxy (Keel #159), never in the page | #3393, Kael #3387, Skeld #3411 |
| Address | `lantern.onlyworlds.com`; a public build is fine ("no one will know it") | #3413 |
| Custom fields | Atlas's custom fields (`x_`, `shadow_`) shown, changed, added and removed on the phone, as Atlas names them; Settings chooses the fields on a page: Filled, All or Yours. A player sees every field of what their Character knows (keel filters elements, not fields) | the Captain h37 #4061; Skeld #4053 |
| The table, S402 | Before now (Events around the world's now), tonight's cast and Recent, a player's own notes kept on their phone (option B; a guest writing into the world, option A, kept for later), given tonight from this phone's reveals (no new element in the world); moving now for the owner and a co-builder (Keel #240, the Captain's "accepted 240") | the Captain h37 #4061, #4072, #4087, #4113, #4192; Skeld #4085, #4214 |
| Sign out on a shared phone | Offers to remove the account's worlds too; not the default | the Captain h37 #4072 |
| Deleting elements | Anyone who can change the world deletes from an element's page, after one warning ("a warning is enough to let it be on the users' head"); it goes through the outbox, and keel removes the links to it. Players never can (they cannot change a world) | the Captain h37 #4292, on Quillon's walk #4275 |
| AI trials | The Captain's Anthropic key, up to about $8, to test Haiku 5.5 on lookup: from local scripts only (`Forge/.env`, `Comms/var/secrets/anthropic-api-key.txt`), never in a bundle. Rotate when the proxy takes over | #3413 |

## How it works

### Keys and sign-in
- **Signed in**: today, paste an account token from onlyworlds.com; when Keel #211 lands, sign in with email and password and the phone gets its own token. Lantern lists `GET /api/v2/account/worlds` (owned and shared) and mints a key named for the phone per world it opens (`POST /api/v2/account/worlds/{id}/keys`), revocable on the portal.
- **A read key** (the demo, a read-shared world): no PIN, no edit controls, no camera.
- **The PIN** is the account's: keel keeps one per account and copies it onto every world it owns (Skeld #3674), so Lantern asks once for all your worlds; a world opened with someone else's key keeps its own. Kept on the phone (the Captain #3675), cleared on sign-out, on a wrong try, and with a world removed (`src/pin.ts`). keel checks a sent PIN on reads too (B4). A 401 on a write stops the outbox and asks again; never a retry loop (keel throttles wrong PINs).
- **A player** joins by the human join link (Keel #212) once #213 is live: open it, see the world and the role, accept.
- Secrets stay on the device (IndexedDB), never in a URL.

### The store on the phone (IndexedDB, one database per world)
- `elements`: every element seen, as the API returned it, with its `change_seq`.
- `outbox`: one row per pending write, in order: the operation, the element id, **the base copy the edit started from**, the new values, an `Idempotency-Key` for creates, a queued photo's bytes, and its state (waiting, sending, refused, needs you).
- `meta`: the `/changes` cursor, the world's name, when it last synced, whether the browser agreed to keep the storage (`navigator.storage.persisted()`, read back and shown).
- A world on this phone only uses the same store with no account behind it; "Save a copy" writes a world file (SDK `writeWorldFile`), "Put it online" creates the world (`POST /api/v2/account/worlds`) and loads it (`/bulk`).

### Reading
Open from the store at once; then `/changes` from the saved cursor (SDK `changesAll`; pages up to 1000; replay is safe). A guest's feed can say `isResyncRequired` when what they may see changes: resync. First open of a world: a full list per type, then the cursor.

### Writing
1. An edit saves to the outbox first and shows "waiting to send"; the screen shows the new values.
2. Online, the outbox sends in order. A PATCH carries `ifMatch` with the base `change_seq` (SDK 4.9+); a create carries its `Idempotency-Key` and an id made on the phone (SDK `uuid7`).
3. The answers: **200** the row leaves, the store takes the element · **412** (`OwPreconditionFailedError`) read `current`, compare the base copy with it on the touched fields: none moved, re-send silently with `current.change_seq`; one moved, "needs you" with both values · **404** on a conditional write: deleted elsewhere; offer "keep it as a new element" or "drop my edit" · **409 upload_pending**: wait `Retry-After` · **401/403**: stop, ask · **no network**: stay waiting, retry when the browser says online.
4. Photos: converted and shrunk on the phone (no HEIC on the edge; webp, png, jpeg, avif, 15 MB), queued like edits, uploaded with the SDK's `uploadImage` when online.

### Old builds
A pinned phone can run an old build for days. Lantern checks for an update on open and holds the outbox while it is behind (Boss #3391).

## Tonight's build, and who carries it

The rule for the night: each piece is its owner's whole, built in their own place; nothing enters Lantern's repo but through Temper's review; Lantern's own builds may be public (the Captain, #3413, read narrowly as Quillon asked: Lantern's deploys only); they fly to Boss's preview address first, with `noindex` in `public/_headers`, no Pages Functions, and `lantern.onlyworlds.com` waits for the Captain's yes after his morning walk. Spend, schema motions, pages and posts outside the ship stay his.

| Who | Piece | Done when |
|---|---|---|
| **Temper** | Lantern: the repo (`Forge/tools/lantern`, private at github.com/OnlyWorlds/lantern, Temper's remit; Vite and TypeScript, SDK 4.10, no framework), the app opening offline (a service worker, the 404 rule), the store, the two themes as theme files, the first screen (Sign in as the main button), your worlds, find, read, the element page, edit with the outbox and the conflict screen, capture with Unsorted | Each piece walked with real taps (Playwright `.tap()`, iPhone 13 and Pixel 7 profiles, WebKit and Chromium, 390 wide), airplane mode included; frames read with my own eyes |
| **Skeld** | keel: #213 first (the guest rule learns Atlas's knowing; leak tests), then #211 (the phone's token after sign-in); #212 (the human join link) next; the Unsorted convention; the keel item list | Tests red first, a live receipt (as #210) |
| **Kael** | SDK: the offline lookup (search, then follow links, from the phone's copy, no model) and photo preparation (convert and shrink, lifted from the old upload page), both released; the five stories (the DM's "strange artifact", the player who receives it, the bus idea, the notebook page, "what was the blacksmith called?") walked through what keel and the SDK can do; a Haiku 5.5 lookup trial from a local script with the Captain's key, within the $8 | Released and tested; the stories and the trial's answers in a short file |
| **Seethe** | Two anchor screens (a world's home and an element) in both themes, warm and house, side by side; then the two theme files Lantern reads (colours, fonts, radii) | The screens for the Captain to choose from; the two theme files as plain CSS custom properties, `src/themes/theme-warm.css` and `src/themes/theme-house.css`, switched by `data-theme` on the root (her contract, #3421); she writes them there, Temper reviews and commits |
| **Quillon** | The maps research bout: a read-only map on a phone, entered from "show on map" (centred on the pin), on Tuvsh Ul (839 pins, 225 zones, 1,430 markers: `Desktop/TESTOWFOLDER/onlyworlds-atlas/tuvsh-ul-019f6295/`) | A prototype and numbers: does it hold, at what limits |
| **Boss** | Hosting: the Pages project for `lantern.onlyworlds.com`, deploy from master, the missing-path 404 check, the stranger's probe | Lantern's first build reachable at its address, probed |

## Later (designed, not tonight)
Players at the table and "give it to the party" (after #213 and #212) · a character's page for anyone (an Atlas sharing block: what one character knows) · Ask through the proxy (#159) · the morning after (the resolve method, Simmer's extraction, through the proxy) · maps, if Quillon's numbers hold · the Android share target · stored voice.

## Out of scope
Drawing maps, charts, the writing room, building pages (Atlas) · folders (no phone browser writes one back) · v1 of the API.

## Traps the crew already knows

- **The service worker** (Boss #3317, measured on Atlas): precaching a path the build does not emit stores the SPA-fallback HTML under that URL, a poisoned entry no status code shows; after each deploy, a known-missing path must return 404. Hashed asset names let installed copies lag until the worker updates. If the host is ever behind Access, the worker must not cache redirects.
- **Phone layout** (Boss): an 18px base and `env(safe-area-inset-bottom)` padding on a fixed bottom bar.
- **iPhone, to test in the first walk, not facts yet** (Kael #3311, Boss #3317): a home-screen app's storage and cookies are apart from Safari's, so a world or login made in a Safari tab does not appear in the pinned app (hence "pin me first" on the first screen); storage persistence is the browser's judgement, so read it back.
- **Voice** (Kael): the browser's speech API does not work in an iPhone home-screen app (WebKit bug 225298); the keyboard's mic is the path.
- **An automated click is not a tap** (#142): phone verdicts come from `.tap()` on a device profile.
- **The address is the install** (Boss #3391): a pinned app, its store and its unsent outbox are bound to the exact origin.
