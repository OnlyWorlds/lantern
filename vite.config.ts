import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'nogit';
  }
}

const BUILD_ID = `${gitSha()}-${Date.now().toString(36)}`;

/** The CSP has one home, public/_headers (what Pages serves); preview serves the same line so walks run under it. */
const CSP = readFileSync('public/_headers', 'utf8').match(/Content-Security-Policy: (.+)/)?.[1]?.trim() ?? '';

/** Files the host serves but the worker must never precache. */
const NOT_PRECACHED = new Set(['sw.js', 'version.json', '_headers', '_redirects', '404.html']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** After the build is written: the worker's precache list is exactly what landed in dist. */
function lanternWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'lantern-worker',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files = walk(outDir)
        .map((p) => relative(outDir, p).split(sep).join('/'))
        .filter((p) => !NOT_PRECACHED.has(p) && !p.endsWith('.map'))
        // Pages answers /index.html with a 308 to /, and the worker refuses a redirect: the shell
        // is precached as "/" itself (probed on the preview, 2026-10-12).
        .map((p) => (p === 'index.html' ? '/' : '/' + p))
        .sort();
      // The scripts this build's shell loads: the worker refuses a "/" that does not name them (a
      // deploy's cutover can serve the previous shell for a moment, Boss h37 #3518).
      const shellScripts = [...readFileSync(join(outDir, 'index.html'), 'utf8').matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
      if (!shellScripts.length) throw new Error('lantern-worker: the shell loads no script');
      const sw = readFileSync('sw/sw.js', 'utf8')
        .replace('__BUILD_ID__', BUILD_ID)
        .replace('__PRECACHE__', JSON.stringify(files))
        .replace('__SHELL_SCRIPTS__', JSON.stringify(shellScripts));
      writeFileSync(join(outDir, 'sw.js'), sw);
      writeFileSync(join(outDir, 'version.json'), JSON.stringify({ build: BUILD_ID }) + '\n');
    },
  };
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [lanternWorker()],
  // mpa: unknown paths 404 in dev and preview, as on Pages with a 404.html (the worker's 404 rule is walked against it).
  appType: 'mpa',
  build: { target: 'es2022' },
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true, headers: CSP ? { 'Content-Security-Policy': CSP } : {} },
});
