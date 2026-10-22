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
| World control | Lantern edits a world's content, its name, description and picture, its "now" and its units. An owner makes invite links on the phone (a contributor, a player, or a player with an account, seven days; Send it, Copy, a QR). Lantern makes a key of its own for each world it opens on a phone (named for the phone) and puts a new one in place when keel stops taking one; taking keys back, members and deleting a world stay on onlyworlds.com | D2, #3393; invite links in the app h56 #5322 (B1); the player link #416 (h50 #7610) |
| Players | A Character the world's owner gives someone: by a player link with no account (keel #353, a read key and no PIN, since S433), or as a guest with an account. Either sees the world as their Character knows it (Keel #213, live since 10-12, keel 2e5b907) | #3397, #3409; #416 |
| Knowing | Atlas's model: a Narrative is known by its `narrator` and by the members of its `collectives`. `characters` on a Narrative means "about", never "knows". keel learns this (Keel #213) | #3394, #3397 |
| Unsorted | Material not yet turned into elements (a photographed page, a spoken ramble) is a Narrative with supertype `Unsorted`, the photo as its picture. Skeld writes the convention for every tool; Lantern shows it first | #3409, #3411 |
| Conflicts | `If-Match` on element PATCH (Keel #210, live). keel never merges; Lantern re-sends by itself when the fields it touched did not move, and asks "keep mine, take theirs" only when the same field moved on both sides | contract |
| Voice | The keyboard's microphone, everywhere. No stored audio in v1 | Kael #3311 |
| Words | Sentence case for every label, button and toast, acronyms kept ("Image URL"); field names from the SDK's `fieldLabel`; "Sign in" the one verb. The house rules live in one place, Studio `style/RULES.md` (OW Style, Seethe): read there, never copied here | the Captain's B1, h63 #8074; F-24 in `1b09b05` |
| Buttons | The house ladder (Studio `style/RULES.md` section 8): `btn-primary`, the accent fill, only on a screen's one main act (the first screen's Sign in, Sign in, Start the world, Catch's Add to Unsorted, a player's Save the note, Join, Sort); `btn-standard`, the accent wash and edge, on a sheet's or a banner's commit; plain `btn` and `btn-quiet` are Quiet; Delete is the wash in the danger colour, never a fill. Lantern keeps its amber (the warm theme's accent) for the fill, and a finger's 48 high where the ladder's desktop shape is 36 | the Captain's "looks good", h63 #8314; amber kept, "leans sound good!", h63 #8343; `883c0fa` |
| Look | Two themes from day one, **warm** (default) and **house**, each one theme file of colours and fonts; a switch in settings. Seethe owns the theme files. Type chips always from the SDK's `FAMILY_COLORS` | #3409, Seethe #3389 |
| Ask | Lookup and review of what exists only: no inventing, no building, sources shown, "your world does not say" a real answer. The phone's own copy answers first (search, then follow links); a model only for what that walk can't. The model sits behind keel's proxy (Keel #159), never in the page | #3393, Kael #3387, Skeld #3411 |
| Address | `lantern.onlyworlds.com`; a public build is fine ("no one will know it") | #3413 |
| Custom fields | Atlas's custom fields (`x_`, `shadow_`) shown, changed, added and removed on the phone, as Atlas names them; Settings chooses the fields on a page: Filled, All or Yours. A player sees every field of what their Character knows (keel filters elements, not fields) | the Captain h37 #4061; Skeld #4053 |
| The table, S402 | Before now (Events around the world's now), tonight's cast and Recent, a player's own notes kept on their phone (option B; a guest writing into the world, option A, kept for later), given tonight from this phone's reveals (no new element in the world); moving now for the owner and a co-builder (Keel #240, the Captain's "accepted 240") | the Captain h37 #4061, #4072, #4087, #4113, #4192; Skeld #4085, #4214 |
| Sign out on a shared phone | Offers to remove the account's worlds too; not the default | the Captain h37 #4072 |
| Deleting elements | Anyone who can change the world deletes from an element's page, after one warning ("a warning is enough to let it be on the users' head"); it goes through the outbox, and keel removes the links to it. Players never can (they cannot change a world) | the Captain h37 #4292, on Quillon's walk #4275 |
| Before now when nothing is dated | Offered on a world's home only once an Event has a start date; with none it opened onto the now line alone | the Captain h37 #4359 |
| A player's notes and the world | Private on the phone by default; "Share with the party" sends one as a Narrative from the player's key, narrated by their Character (keel fills it in), shared with the party's Collective (keel #241) | the Captain h37 #4420, to #4419 |
| Dates in a world's calendar | Atlas's calendar (`atlas_calendar`, read through SDK 4.20+, never written: Skeld #4286) names a world's dates when it holds one; with several, the phone offers the choice, kept per phone as Atlas keeps its own; with none, the numbers | Kael h37 #4287, #4294 |
| A player's first share | A player's key only reads until their first shared note, which mints a write key for their own seat; refused before any mint unless the phone is signed in as that player (the S406 gate, G1) | Temper S406, on the Captain's B (#4420) |
| A key keel stops taking | Replaced in place, never by opening the world again (which drops the copy): the copy, its cursor and its waiting changes stay. The home says keel's cause (revoked, no longer known, a read key) and offers Make a new key (an account world, from the signed-in account; a guest or a member with no PIN gets a read key) and Put in a new key (any key that opens this world). A dead key never asks for the PIN, and a refused PIN is never answered with a new key | the Captain's go on Atlas #198 (terminal, 2026-10-16), carried here as its twin, S418 |
| The buttons that keep a note | Catch's says where the note goes, "Add to Unsorted"; a player's own Notes says "Save the note" ("Keep it" read as unclear) | the Captain h37 #4359 |
| Known of | keel's stub (what a player's Character points to, one step out) is kept as a stub with what keel shares on it, never changed, deleted or sent, and shown as known of with its shared fields read only. Which fields are shared is keel's (a public tag in its schema), read from what keel served, never a list here | the folder spec §4.4 rules 1 to 5; keel PR 113, PR 117 (#448, the Captain h65 #8495); Atlas's contract `Forge/Notes/2026-10-20-s443-known-of-stubs.md`; S444 |
| AI trials | The Captain's Anthropic key, up to about $8, to test Haiku 5.5 on lookup: from local scripts only (`Forge/.env`, `Comms/var/secrets/anthropic-api-key.txt`), never in a bundle. Rotate when the proxy takes over | #3413 |
| The parlor's room | A world's parlor lives inside the world, each of its elements carrying the parlor's mark `x_room_of` (schema-dist room profile, dist.45: the pair AND the mark; a Message without it is lore) (its messages, board entries, work items, specs, hearts, votes, sittings and member cards, each a type with its own supertype). Lantern's lists, search, Ask's lookup, Before now, a page's links and the field suggestions read the world without them; the home says how many the world holds and one tap shows them, kept per phone and per world (`src/room.ts`, Atlas's same pairs). The charter stays in | the sheet §1 (Orrery `parlor/design-sheet.md`); the Captain's note on it, 2026-10-22 (lore must not read as polluted); OW Parlor #543 |
| A zone's shape | The standard's `shape` (schema 00.33.00: polygon or line, anything else not stated) first, then Atlas's `atlas_shape`, then a "line" supertype; else a polygon (`src/maps.ts` `zoneShape`, Atlas 1.75's rule) | h58 #10075 |

## How it works

### Keys and sign-in
- **Signed in**: an email or username and the password (Keel #211, the SDK's `signInWithPassword`) give the phone its own account token; a token pasted from onlyworlds.com still works behind "I have an account token". Lantern lists `GET /api/v2/account/worlds` (owned and shared) and mints a key named for the phone per world it opens (`POST /api/v2/account/worlds/{id}/keys`), revocable on the portal.
- **A read key** (the demo, a read-shared world): no PIN, no edit controls, no camera.
- **The PIN** is the account's: keel keeps one per account and copies it onto every world it owns (Skeld #3674), so Lantern asks once for all your worlds; a world opened with someone else's key keeps its own. Kept on the phone (the Captain #3675), cleared on sign-out, on a wrong try, and with a world removed (`src/pin.ts`). keel checks a sent PIN on reads too (B4). A 401 on a write that names the PIN (param `API-Pin`, keel #357) stops the outbox and asks again; never a retry loop (keel throttles wrong PINs). A 401 that is the key's (`key_revoked`, or `invalid_credentials` with no param) keeps the PIN and the changes, and asks for a new key instead (`src/keyrefusal.ts`, the Decided table).
- **A player** joins by a join link (Keel #212): open it, see the world and the role, accept. A player link (keel #353) needs no account: the phone gets the player's read key.
- Secrets stay on the device, never in a URL: the account token and the world keys in IndexedDB, the PIN (and a kept sort) in localStorage (the security pass's F6: the same exposure on a phone).

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
