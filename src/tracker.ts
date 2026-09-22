/**
 * The tracked universe: which funds the pipeline collects data for.
 *
 * This file READS ONLY. The universe is built by `node scripts/build-universe.js`,
 * which merges the platform crawls, applies the admission rules, fills the holes from
 * the override store, and writes `universe.json`. Nothing here knows a platform's
 * field names, so adding a platform never edits this file.
 *
 *   node scripts/fetch-itau-rentabilidade.js    crawl  Itaú retail catalogue
 *   node scripts/fetch-itau-documents.js        crawl  Itaú lâmina -> CNPJ
 *   node scripts/fetch-opin-pension.js          crawl  Itaú previdência via OPIN
 *   node scripts/fetch-onze-funds.js            crawl  Onze plan via regulamento
 *   node scripts/build-universe.js              merge + enrich + write
 */
import * as universe from './corretoras/universe.json';

export type Platform = 'ITAU' | 'ITAU_PREV' | 'ONZE';

interface UniverseFund {
  cnpj: string;
  name: string;
  platforms: string[];
}

interface UniverseArtifact {
  counts: {distinct: number; unresolved: number};
  funds: UniverseFund[];
}

const format = (cnpj: string) =>
  cnpj
    .replace(/\D+/g, '')
    .replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');

const artifact = universe as unknown as UniverseArtifact;
const funds = artifact.funds;
const counts = artifact.counts;

const availability = new Map<string, Platform[]>();
const officialName = new Map<string, string>();

for (const f of funds) {
  availability.set(f.cnpj, f.platforms as Platform[]);
  if (f.name) officialName.set(f.cnpj, f.name);
}

const onPlatform = (p: Platform) =>
  funds.filter(f => f.platforms.includes(p)).map(f => f.cnpj);

export const ITAU_FUNDOS = onPlatform('ITAU');
export const ITAU_PREV_FUNDOS = onPlatform('ITAU_PREV');
export const ONZE_FUNDOS = onPlatform('ONZE');

export const CNPJ_FUNDOS = funds.map(f => f.cnpj);

export function isTracked(cnpj: string | undefined | null) {
  if (!cnpj) return false;
  return availability.has(format(String(cnpj)));
}

export function availabilityOf(cnpj: string): Platform[] {
  return availability.get(format(cnpj)) ?? [];
}

export function nameOf(cnpj: string): string | undefined {
  return officialName.get(format(cnpj));
}

/**
 * `unresolved` is the count of funds a platform SELLS that carry no CNPJ, so they
 * could not enter. It is surfaced here because a universe size reported without it
 * reads as complete when it is not.
 */
export const UNIVERSE_SUMMARY = {
  ITAU: ITAU_FUNDOS.length,
  ITAU_PREV: ITAU_PREV_FUNDOS.length,
  ONZE: ONZE_FUNDOS.length,
  distinct: CNPJ_FUNDOS.length,
  unresolved: counts.unresolved,
};
