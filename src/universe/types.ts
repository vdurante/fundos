/**
 * The types the universe stages share.
 *
 * `Resolution` is the point of this file. It was a free-form string, which is why
 * renaming the field it lives in was a text substitution plus a cache migration that
 * nearly blanked 433 values. As a closed union, adding or renaming a rule is a compile
 * error at every site that reads it.
 */

export type Platform = 'ITAU' | 'ITAU_PREV' | 'ONZE';

/** A rule identified the fund's own CNPJ. */
export type ResolvedBy =
  | 'class-label'
  | 'wire-beneficiary'
  | 'page-header'
  | 'sole-registered-fund'
  | 'not-named-as-other-fund'
  | 'cnpj-label'
  | 'class-not-fund'
  | 'opin-published'
  | 'override';

/** No rule could, and this says why. */
export type Unresolved =
  | 'no-cnpj-in-document'
  | 'no-cnpj-is-a-registered-fund'
  | 'only-the-master-is-named'
  | 'no-regulation-url'
  | 'ambiguous'
  | 'fetch-blocked'
  | 'no-document-anywhere';

export type Resolution = ResolvedBy | Unresolved;

export {RegistryEntry} from '../lib/cvm-registry';
import {RegistryEntry} from '../lib/cvm-registry';

export interface Registry {
  size: number;
  classes: number;
  funds: number;
  ageDays: number;
  lookup(cnpj: string): RegistryEntry | null;
  has(cnpj: string): boolean;
  entries(): IterableIterator<RegistryEntry>;
}

export interface FundRecord {
  /** `<PLATFORM>#<id>` — the override store's key. */
  key: string;
  platform: Platform;
  id: string;
  name: string;
  hint: string | null;
  cnpj: string | null;
  officialName: string | null;
  situacao: string | null;
  resolution: Resolution | null;
  /** The platform sells it, not merely lists it. */
  onShelf: boolean;
  /** The CVM name says MASTER — a wholesale vehicle, never investable. */
  master: boolean;
  override?: {why: string; sourcedBy: string};
  /** Set when a prompt answer failed validation. */
  refused?: string;
}

export interface OverrideEntry {
  cnpj: string;
  why: string;
  sourcedBy: string;
}

export type OverrideStore = Record<string, OverrideEntry>;

export interface PlatformCounts {
  listed: number;
  entered: number;
  noCnpj: number;
  offShelf: number;
  master: number;
  notOperating: number;
}

export interface UniverseFund {
  cnpj: string;
  name: string;
  platforms: Platform[];
  keys: string[];
  resolution: Resolution | null;
}

export interface MergeResult {
  funds: UniverseFund[];
  byPlatform: Partial<Record<Platform, PlatformCounts>>;
  rejected: (FundRecord & {why: string})[];
}

export type AskFn = (
  fund: FundRecord,
  check: (entry: OverrideEntry) => string | null,
) => Promise<OverrideEntry | null>;

export interface EnrichResult {
  problems: string[];
  applied: {key: string; name: string; cnpj: string}[];
  stale: {
    key: string;
    name: string;
    cnpj: string;
    resolution: Resolution | null;
  }[];
  conflicts: {
    key: string;
    name: string;
    crawled: string;
    resolution: Resolution | null;
    override: string;
  }[];
  missing: FundRecord[];
  records: FundRecord[];
}
