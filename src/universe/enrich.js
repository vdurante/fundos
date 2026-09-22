'use strict';

/**
 * Stage 3. Given the merged records, fill the holes the crawls left.
 *
 * Pure with respect to I/O except through `ask`: when no `ask` is supplied (cron, CI,
 * --no-prompt) the holes are reported rather than asked about, so the pipeline still
 * runs unattended. A hole is never guessed — an unresolved fund is honest, a wrong
 * CNPJ computes wrong returns that nothing downstream can detect.
 */

const overrides = require('./overrides');
const {format} = require('../lib/cnpj');

/**
 * @param {object[]} records normalized fund records
 * @param {object} registry loaded CVM registry
 * @param {{ask?: (fund: object) => Promise<object|null>}} opts
 */
async function enrich(input, registry, opts = {}) {
  const records = input;
  const byKey = new Map(records.map(r => [r.key, r]));
  const store = overrides.load();

  const problems = [];
  for (const [key, entry] of Object.entries(store)) {
    const problem = overrides.validate(key, entry, byKey, registry);
    if (problem) problems.push(problem);
  }
  if (problems.length)
    return {
      problems,
      applied: [],
      stale: [],
      conflicts: [],
      missing: [],
      records,
    };

  const conflicts = [];
  const stale = [];
  for (const [key, entry] of Object.entries(store)) {
    const fund = byKey.get(key);
    if (!fund.cnpj) continue;
    if (format(fund.cnpj) === format(entry.cnpj)) {
      stale.push({
        key,
        name: fund.name,
        cnpj: fund.cnpj,
        resolution: fund.resolution,
      });
    } else {
      conflicts.push({
        key,
        name: fund.name,
        crawled: fund.cnpj,
        resolution: fund.resolution,
        override: format(entry.cnpj),
      });
    }
  }
  if (conflicts.length)
    return {problems: [], applied: [], stale, conflicts, missing: [], records};

  const applied = [];
  const missing = [];
  const out = [];
  let added = false;

  for (const source of records) {
    if (source.cnpj || !source.onShelf) {
      out.push(source);
      continue;
    }
    const fund = {...source};

    let entry = store[fund.key];
    if (!entry && opts.ask) {
      const check = e => overrides.validate(fund.key, e, byKey, registry);
      entry = await opts.ask(fund, check);
      if (entry) {
        const problem = check(entry);
        if (problem) {
          missing.push({...fund, refused: problem});
          out.push(fund);
          continue;
        }
        store[fund.key] = entry;
        added = true;
      }
    }
    if (!entry) {
      missing.push(fund);
      out.push(fund);
      continue;
    }
    const cnpj = format(entry.cnpj);
    const reg = registry.lookup(cnpj);
    fund.cnpj = cnpj;
    fund.officialName = reg.name;
    fund.situacao = reg.situacao;
    fund.resolution = 'override';
    fund.override = {why: entry.why, sourcedBy: entry.sourcedBy};
    out.push(fund);
    applied.push({key: fund.key, name: fund.name, cnpj});
  }

  if (added) overrides.save(store);
  return {problems: [], applied, stale, conflicts, missing, records: out};
}

module.exports = {enrich};
