import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Identitas build (versioning). Sumber kebenaran versi: `version` di package.json root (SemVer, dinaikkan oleh
 * `npm run release`). Image Docker menyuntikkan APP_VERSION/GIT_SHA/BUILD_DATE saat build; di dev dibaca dari repo.
 */
function rootVersion(): string {
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package.json');
    return (JSON.parse(readFileSync(p, 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const BUILD_INFO = Object.freeze({
  version: process.env.APP_VERSION || rootVersion(),
  commit: process.env.GIT_SHA || 'dev',
  built_at: process.env.BUILD_DATE || null,
});
