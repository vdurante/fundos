import {
  CellValue,
  ColumnMap,
  KeyedWriteSummary,
  writeKeyed,
} from './sheet-writer';

export type Platform = 'BTG' | 'XP' | 'ONZE';

export interface CanonicalFund {
  cnpj: string;
  name: string;
  type?: string;
  volatility?: number;
  availability?: Platform[];
  monthsOfHistory?: number;
}

export const PRINCIPAL_SHEET = 'Principal';
export const PRINCIPAL_HEADER_ROWS = 2;

export const PRINCIPAL_COLUMNS: ColumnMap = {
  CNPJ: 'A',
  DENOM_SOCIAL: 'B',
  BTG: 'H',
  XP: 'I',
  Vol: 'J',
  MANUAL: 'AD',
};

export const PRINCIPAL_HEADERS = Object.keys(PRINCIPAL_COLUMNS);

export const UNRANKABLE_TYPES = ['FIP', 'FII'];

export interface Selection {
  kept: CanonicalFund[];
  excludedByType: CanonicalFund[];
  excludedNoHistory: CanonicalFund[];
  duplicates: string[];
}

export function selectFunds(funds: CanonicalFund[]): Selection {
  const kept: CanonicalFund[] = [];
  const excludedByType: CanonicalFund[] = [];
  const excludedNoHistory: CanonicalFund[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const fund of funds) {
    const cnpj = String(fund.cnpj ?? '').trim();
    if (!cnpj) {
      continue;
    }
    if (seen.has(cnpj)) {
      duplicates.push(cnpj);
      continue;
    }
    seen.add(cnpj);

    const type = String(fund.type ?? '')
      .trim()
      .toUpperCase();
    if (UNRANKABLE_TYPES.includes(type)) {
      excludedByType.push(fund);
      continue;
    }

    if (!fund.monthsOfHistory) {
      excludedNoHistory.push(fund);
      continue;
    }

    kept.push(fund);
  }

  return {kept, excludedByType, excludedNoHistory, duplicates};
}

export function principalRow(fund: CanonicalFund): {
  [header: string]: CellValue;
} {
  const platforms = fund.availability ?? [];
  return {
    CNPJ: fund.cnpj,
    DENOM_SOCIAL: fund.name,
    BTG: platforms.includes('BTG'),
    XP: platforms.includes('XP'),
    Vol: fund.volatility,
    MANUAL: platforms.includes('ONZE'),
  };
}

export interface WritePrincipalResult {
  selection: Omit<
    Selection,
    'kept' | 'excludedByType' | 'excludedNoHistory'
  > & {
    kept: number;
    excludedByType: number;
    excludedNoHistory: number;
  };
  write?: KeyedWriteSummary;
  dryRun: boolean;
}

export async function writePrincipal(
  funds: CanonicalFund[],
  options: {sheetTitle?: string; dryRun?: boolean} = {}
): Promise<WritePrincipalResult> {
  const sheetTitle = options.sheetTitle ?? PRINCIPAL_SHEET;
  const dryRun = options.dryRun ?? false;

  const selection = selectFunds(funds);
  const counts = {
    kept: selection.kept.length,
    excludedByType: selection.excludedByType.length,
    excludedNoHistory: selection.excludedNoHistory.length,
    duplicates: selection.duplicates,
  };

  if (dryRun) {
    return {selection: counts, dryRun: true};
  }

  const write = await writeKeyed(
    sheetTitle,
    PRINCIPAL_HEADERS,
    selection.kept.map(principalRow),
    {
      columns: PRINCIPAL_COLUMNS,
      headerRowCount: PRINCIPAL_HEADER_ROWS,
    }
  );

  return {selection: counts, write, dryRun: false};
}
