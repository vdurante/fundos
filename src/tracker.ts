/**
 * The tracked universe: which funds the pipeline collects data for.
 *
 * Built from the platform collectors, not from a hand-maintained list and not from the
 * spreadsheet. `Principal` is derived OUTPUT — it is rewritten from this universe on every
 * run, so nothing in the sheet feeds back in here.
 *
 * Sources, each produced by its own collector:
 *   ITAU       scripts/fetch-itau-rentabilidade.js -> scripts/fetch-itau-documents.js
 *   ONZE       scripts/fetch-onze-funds.js
 *   ITAU_PREV  scripts/fetch-opin-pension.js --host api.itau --platform ITAU_PREV
 *
 * A fund enters the universe when a platform lists it AND the CVM registry says it is
 * operating. That conjunction is the openness rule: "listed" only proves availability as
 * fresh as the crawl, so the registry status is what stops a stale snapshot asserting a
 * dead fund is purchasable.
 */
import * as itauDocs from './corretoras/itau-documents.json';
import * as itauPrevFunds from './corretoras/itau-prev-funds.json';
import * as onzeFunds from './corretoras/onze-funds.json';

export type Platform = 'ITAU' | 'ITAU_PREV' | 'ONZE';

/** CVM registry status meaning the fund is alive; any other value is not tracked. */
const OPERATING = 'Em Funcionamento Normal';

interface CollectedFund {
  cnpj?: string | null;
  situacao?: string | null;
  nomeOficial?: string | null;
  name?: string | null;
  nomeComercial?: string | null;
  /** OPIN only: the deferral-product-count heuristic for "purchasable on the shelf". */
  onShelf?: boolean;
  /** OPIN only: the CVM name says MASTER — a wholesale vehicle, never an identity. */
  master?: boolean;
}

const format = (cnpj: string) =>
  cnpj
    .replace(/\D+/g, '')
    .replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');

/** Keep only rows the collector actually resolved AND the registry says are operating. */
function operating(rows: CollectedFund[]): {cnpj: string; name: string}[] {
  return rows
    .filter(r => r.cnpj && r.situacao === OPERATING)
    .map(r => ({
      cnpj: format(String(r.cnpj)),
      name: String(r.nomeOficial ?? r.name ?? r.nomeComercial ?? ''),
    }));
}

const BY_PLATFORM: Record<Platform, {cnpj: string; name: string}[]> = {
  ITAU: operating(itauDocs as unknown as CollectedFund[]),
  ONZE: operating(onzeFunds as unknown as CollectedFund[]),
  // OPIN publishes the insurer's whole fund list, not its purchasable shelf, so the
  // deferral-product heuristic (>=4 and even) narrows 268 -> 165. Masters are dropped
  // separately: one of the 166 the heuristic accepts is ITAÚ VERDE MASTER PREV 60.
  ITAU_PREV: operating(
    (itauPrevFunds as unknown as CollectedFund[]).filter(f => f.onShelf && !f.master)
  ),
};

export const ITAU_FUNDOS = BY_PLATFORM.ITAU.map(f => f.cnpj);
export const ITAU_PREV_FUNDOS = BY_PLATFORM.ITAU_PREV.map(f => f.cnpj);
export const ONZE_FUNDOS = BY_PLATFORM.ONZE.map(f => f.cnpj);

/** Platform availability per CNPJ; a fund can be on more than one. */
const availability = new Map<string, Platform[]>();
/** The CVM official name, carried so writePrincipal need not re-join the registry. */
const officialName = new Map<string, string>();

for (const platform of Object.keys(BY_PLATFORM) as Platform[]) {
  for (const {cnpj, name} of BY_PLATFORM[platform]) {
    const seen = availability.get(cnpj);
    if (seen) {
      if (!seen.includes(platform)) seen.push(platform);
    } else {
      availability.set(cnpj, [platform]);
    }
    if (name && !officialName.has(cnpj)) officialName.set(cnpj, name);
  }
}

export const CNPJ_FUNDOS = [...availability.keys()];

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

export const UNIVERSE_SUMMARY = {
  ITAU: ITAU_FUNDOS.length,
  ITAU_PREV: ITAU_PREV_FUNDOS.length,
  ONZE: ONZE_FUNDOS.length,
  distinct: CNPJ_FUNDOS.length,
};
