'use strict';

/**
 * Hand-supplied CNPJs, for funds no crawl could identify.
 *
 * An override bypasses every automatic rule, so it is the one place a typo becomes
 * permanent AND self-consistent — nothing downstream can contradict it. That is not
 * hypothetical: a hand-typed pairing kept 'QUANTAMENTAL GEMS FIA' on Itaú Small Cap
 * II's CNPJ for years. Hence every entry is validated against the CVM registry on
 * load, and the run fails rather than trusting the file.
 *
 * Overrides are consulted ONLY where the crawl found nothing. A crawled value wins,
 * so a source that starts publishing the CNPJ makes its override redundant instead of
 * being permanently masked by it.
 */

const fs = require('fs');
const path = require('path');
const {validCnpj, isMaster, format, sharedWords} = require('../lib/cnpj');

const FILE = path.join(
  __dirname, '..', 'corretoras', 'cnpj-overrides.json'
);

const README = [
  'Hand-supplied CNPJs for funds whose source document does not yield one.',
  '',
  'Keyed by "<PLATFORM>#<id>" — the platform\'s own stable id (codigoProduto for',
  'ITAU, the catalogue uuid for ONZE, the CNPJ itself for ITAU_PREV).',
  '',
  'Consulted ONLY when the crawl resolved nothing. If a source later starts',
  'publishing the CNPJ, the crawled value wins and the override is reported as no',
  'longer needed — it never masks the source fixing itself.',
  '',
  'Every entry is validated on load and the run FAILS if one does not:',
  '  1. pass the CNPJ check digits,',
  '  2. resolve to a registered CNPJ in the CVM registry,',
  '  3. name a non-MASTER vehicle, and',
  '  4. share a significant word with the platform\'s own name for the fund.',
  '',
  'Rule 4 is what an unchecked override lacks. "why" and "sourcedBy" are required so',
  'a stale entry can be re-checked rather than trusted forever.',
];

function load() {
  if (!fs.existsSync(FILE)) return {};
  return JSON.parse(fs.readFileSync(FILE, 'utf8')).overrides || {};
}

function save(overrides) {
  const ordered = {};
  for (const k of Object.keys(overrides).sort()) ordered[k] = overrides[k];
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({_README: README, overrides: ordered}, null, 2) + '\n'
  );
  fs.renameSync(tmp, FILE);
}

/** @returns {string|null} the reason to refuse, or null when the entry is sound. */
function validate(key, entry, byKey, registry) {
  const fund = byKey.get(key);
  if (!fund) return `${key}: no fund with that key in any platform's catalogue`;
  if (!entry || !entry.cnpj) return `${key}: missing "cnpj"`;
  if (!validCnpj(entry.cnpj)) {
    return `${key}: ${entry.cnpj} fails the CNPJ check digits`;
  }
  const cnpj = format(entry.cnpj);
  const reg = registry.lookup(cnpj);
  if (!reg) return `${key}: ${cnpj} is not a registered CNPJ in the CVM registry`;
  if (isMaster(reg.name)) {
    return (
      `${key}: ${cnpj} is "${reg.name}" — a MASTER, which no shelf sells. Several ` +
      `feeders invest into it, so it cannot identify one product, and its quota ` +
      `series is gross of the feeder's fee. Find the feeder above it.`
    );
  }
  if (!sharedWords(fund.name, reg.name).length) {
    return (
      `${key}: ${cnpj} is registered as "${reg.name}" which shares no significant ` +
      `word with the platform name "${fund.name}" — check the pairing`
    );
  }
  if (!entry.why || !entry.sourcedBy) {
    return `${key}: needs both "why" and "sourcedBy"`;
  }
  return null;
}

module.exports = {FILE, README, load, save, validate};
