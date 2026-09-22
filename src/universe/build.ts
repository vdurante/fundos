#!/usr/bin/env node
/**
 * Build the tracked universe from the platform crawls.
 *
 *   crawl      per-platform scripts, already run, each a record of what it FOUND
 *   merge      normalize -> admission rules -> universe          (lib/merge.js)
 *   enrich     fill the holes from the override store, asking     (lib/enrich.js)
 *   write      src/corretoras/universe.json, consumed by tracker.ts
 *
 * Usage:
 *   node src/universe/build.js               # prompts for missing CNPJs on a tty
 *   node src/universe/build.js --no-prompt   # report holes, never ask (cron/CI)
 *   node src/universe/build.js --dry-run     # report only, write nothing
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import {dataFile} from '../lib/paths';

import {collect, PLATFORMS} from './fund-record';
import {merge} from './merge';
import {enrich} from './enrich';
import {loadRegistry} from '../lib/cvm-registry';
import * as overridesStore from './overrides';
import {
  AskFn,
  FundRecord,
  OverrideEntry,
  Platform,
  PlatformCounts,
} from './types';

const OUT = dataFile('universe.json');

const pad = (s: unknown, n: number) => String(s).padEnd(n);

function prompter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const question = (q: string): Promise<string> =>
    new Promise(res => rl.question(q, a => res(a.trim())));
  const who = `${os.userInfo().username} ${new Date().toISOString().slice(0, 10)}`;

  return {
    close: () => rl.close(),
    async ask(fund: FundRecord, check: (e: OverrideEntry) => string | null) {
      console.log(`\n  ${fund.key}  ${fund.name}`);
      console.log(`  reason: ${fund.resolution || 'no document'}`);
      if (fund.hint) console.log(`  hint:   ${fund.hint}`);
      for (let attempt = 0; attempt < 3; attempt++) {
        const answer = await question('  CNPJ (blank to skip): ');
        if (!answer) return null;
        const entry: OverrideEntry = {
          cnpj: answer,
          why: fund.resolution || 'no document from any source',
          sourcedBy: `${who}, entered at the prompt`,
        };
        const problem = check(entry);
        if (!problem) {
          console.log('  accepted');
          return entry;
        }
        console.log(`  REFUSED — ${problem}`);
      }
      console.log('  skipped after 3 attempts');
      return null;
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n: string) => argv.includes(n);
  const dryRun = flag('--dry-run');
  const interactive = !flag('--no-prompt') && !dryRun && process.stdin.isTTY;

  const registry = await loadRegistry();
  const records = collect();

  const prompt = interactive ? prompter() : null;
  const result = await enrich(
    records,
    registry,
    prompt ? {ask: prompt.ask} : {},
  );
  if (prompt) prompt.close();

  if (result.problems.length) {
    console.error(`\nOVERRIDES REJECTED (${result.problems.length}):`);
    for (const p of result.problems) console.error(`  ${p}`);
    console.error(
      '\nAn override the registry cannot corroborate is a typo waiting to become ' +
        'permanent. Fix the file rather than removing the check.',
    );
    process.exit(1);
  }

  if (result.conflicts.length) {
    console.error(`\nOVERRIDE CONFLICTS (${result.conflicts.length}):`);
    for (const c of result.conflicts) {
      console.error(`  ${c.key}  ${c.name}`);
      console.error(`    crawled  ${c.crawled}  (${c.resolution})`);
      console.error(`    override ${c.override}`);
    }
    console.error(
      '\nThe crawl now yields a different CNPJ than the override. Either the override ' +
        'is wrong, or the source changed to a different vehicle — most likely a master. ' +
        'Resolve it deliberately; nothing was applied.',
    );
    process.exit(1);
  }

  const {funds, byPlatform} = merge(result.records);

  console.log('');
  console.log(
    pad('platform', 12) +
      ['listed', 'entered', 'no cnpj', 'off shelf', 'master', 'dead']
        .map((h: string) => h.padStart(10))
        .join(''),
  );
  for (const p of PLATFORMS) {
    const s = byPlatform[p] || {
      listed: 0,
      entered: 0,
      noCnpj: 0,
      offShelf: 0,
      master: 0,
      notOperating: 0,
    };
    console.log(
      pad(p, 12) +
        [s.listed, s.entered, s.noCnpj, s.offShelf, s.master, s.notOperating]
          .map((n: number) => String(n).padStart(10))
          .join(''),
    );
  }
  console.log(`\ndistinct funds in the universe: ${funds.length}`);

  if (result.applied.length) {
    console.log(`\noverrides applied (${result.applied.length}):`);
    for (const a of result.applied)
      console.log(`  ${pad(a.key, 22)} ${a.cnpj}  ${a.name}`);
  }

  if (result.stale.length) {
    console.log(
      `\noverrides NO LONGER NEEDED (${result.stale.length}) — the crawl now`,
    );
    console.log('resolves these itself; delete them when you are ready:');
    for (const s of result.stale) {
      console.log(`  ${pad(s.key, 22)} ${s.cnpj}  via ${s.resolution}`);
    }
  }

  if (result.missing.length) {
    console.log(
      `\nSTILL MISSING A CNPJ (${result.missing.length}) — excluded from the universe:`,
    );
    for (const m of result.missing) {
      console.log(
        `  ${pad(m.key, 22)} ${pad(m.resolution || 'no document', 30)} ${m.name.slice(0, 40)}`,
      );
      if (m.refused) console.log(`    refused: ${m.refused}`);
    }
    if (!interactive) {
      console.log(`\n  run without --no-prompt on a tty to supply them.`);
    }
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing written');
    return;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    counts: {
      byPlatform,
      distinct: funds.length,
      unresolved: result.missing.length,
    },
    unresolved: result.missing.map(m => ({
      key: m.key,
      name: m.name,
      resolution: m.resolution || null,
    })),
    funds,
  };
  const tmp = `${OUT}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
  fs.renameSync(tmp, OUT);
  console.log(`\nwrote ${OUT}`);
  console.log(`overrides ${overridesStore.FILE}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
