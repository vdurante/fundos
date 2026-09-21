const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');

const PKG = path.resolve(__dirname, '..');
const CLASP = path.join(PKG, 'node_modules', '.bin', 'clasp');
const PROJECT = JSON.parse(fs.readFileSync(path.join(PKG, '.clasp.json'), 'utf8'));
const LOCAL_DIR = path.join(PKG, PROJECT.rootDir);
const MAX_ATTEMPTS = 3;

function clasp(args, cwd) {
  return execFileSync(CLASP, args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
}

function push() {
  const out = clasp(['push', '--force'], PKG);
  process.stdout.write(out);
  if (/Skipping push/.test(out)) {
    throw new Error('clasp skipped the push despite --force');
  }
}

function fetchLive() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clasp-verify-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(
    path.join(dir, '.clasp.json'),
    JSON.stringify({scriptId: PROJECT.scriptId, rootDir: 'src'})
  );
  clasp(['pull'], dir);
  return path.join(dir, 'src');
}

function compare(liveDir) {
  const pick = d => fs.readdirSync(d).filter(f => /\.(js|gs|json|html)$/.test(f)).sort();
  const local = pick(LOCAL_DIR);
  const live = pick(liveDir);

  const mismatches = [];
  for (const name of new Set([...local, ...live])) {
    if (!local.includes(name)) {
      mismatches.push(`${name}: present live, absent locally`);
      continue;
    }
    if (!live.includes(name)) {
      mismatches.push(`${name}: present locally, absent live`);
      continue;
    }
    const a = fs.readFileSync(path.join(LOCAL_DIR, name), 'utf8');
    const b = fs.readFileSync(path.join(liveDir, name), 'utf8');
    if (a !== b) {
      mismatches.push(`${name}: content differs`);
    }
  }
  return {mismatches, count: local.length};
}

function main() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    push();

    const liveDir = fetchLive();
    const {mismatches, count} = compare(liveDir);
    fs.rmSync(path.dirname(liveDir), {recursive: true, force: true});

    if (mismatches.length === 0) {
      console.log(`verified: live matches ${PROJECT.rootDir}/ (${count} files), attempt ${attempt}`);
      return;
    }

    console.warn(`attempt ${attempt}: live does NOT match after push`);
    mismatches.forEach(m => console.warn(`  ${m}`));

    if (attempt === MAX_ATTEMPTS) {
      console.error(
        `failed after ${MAX_ATTEMPTS} attempts — see https://github.com/google/clasp/issues/507`
      );
      process.exit(1);
    }
  }
}

main();
