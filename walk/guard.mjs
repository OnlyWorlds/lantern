// Every walk imports this first: a walk that runs past its limit stops with its own exit code and
// says so, instead of hanging (S402: two runs of walk.mjs hung past 280 s on WebKit rather than fail).
// WALK_LIMIT_S overrides the limit for a slow machine or a big world.
const limit = Number(process.env.WALK_LIMIT_S) || 420;
setTimeout(() => {
  console.log(`\nTIMED OUT: the walk ran past ${limit} s (exit 3; WALK_LIMIT_S sets the limit)`);
  process.exit(3);
}, limit * 1000).unref();
