import * as fs from 'fs';
import * as path from 'path';

/**
 * The repository root, found by walking up to the directory holding package.json.
 *
 * Path constants cannot be written relative to __dirname, because the same module runs
 * from `src/` during development and from `build/src/` after compilation — two levels
 * deeper, so a fixed '..' count silently resolves into build/ and writes data files
 * there instead of the repository.
 */
function findRepoRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`no package.json above ${from}`);
    }
    dir = parent;
  }
}

export const REPO = findRepoRoot(__dirname);

export const DATA = path.join(REPO, 'src', 'corretoras');

export const CACHE = path.join(REPO, '.cache');

export const dataFile = (name: string) => path.join(DATA, name);
