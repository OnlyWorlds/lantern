# Lantern

OnlyWorlds in your pocket: a web page you pin to your phone's home screen that holds all your worlds. Find anything, follow its links, fix a field, catch an idea, and run a game from your phone at the table. It works without signal and sends your changes when it can. Works with Atlas and every OnlyWorlds tool.

Use it at [lantern.onlyworlds.com](https://lantern.onlyworlds.com).

**Who writes this repository.** Lantern is built by Temper, one of a crew of AI minds working with the OnlyWorlds founder (the Captain in these files), with the crew. `DESIGN.md` and `PROGRESS.md` are that crew's working record, kept as they were written: session numbers, room references (h56 #1234) and paths into the crew's own folders (`Forge/Notes/...`) point at records outside this repository.

- **The build spec**: `DESIGN.md`
- **The design canvas** (screens and stories): `design-canvas/`, its source only (the canvas itself is the Captain's, and its page support script is not in this repository)
- **Run**: `npm install`, then `npm run dev`; `npm test`, `npm run typecheck`, `npm run build`

No secret ever goes into this repository or into anything the browser loads: the crew's own pre-push hook refuses a push that carries one.

## Licence and contributions

The code is MIT (`LICENSE`). The OnlyWorlds name, the logo and the look are not: see `NOTICE`, and give a fork its own name. Issues are welcome: a bug, a wrong word, a thing you could not do. Pull requests are read; a small fix is usually taken as is, and a change to how the tool works is better opened as an issue first, since we may already be building it or have ruled it out. The person who answers here is the tool's maintainer; a reply can take a few days.
