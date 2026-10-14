// Where a live write walk writes (Skeld h37 #4352): W11, Curse of Strahd, keel's probe-write world.
// Never Hyperion: it is the frozen source of Atlas's tour, and even a create then delete leaves a
// tombstone and moves its change head for every client syncing it. The key writes only with the
// account's PIN (OW_PIN_FILE), which never sits in this repo.
export const WRITE_WORLD_KEY = '0000000011';
