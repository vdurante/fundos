import axios from 'axios';
import * as Papa from 'papaparse';
import {CsvType} from '../shared';

const BCB_CDI_URL =
  'https://api.bcb.gov.br/dados/serie/bcdata.sgs.4391/dados?formato=json&dataInicial=01/01/2000';

const B3_MONTHLY_EVOLUTION =
  'https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetMonthlyEvolution/';

const TESOURO_PACKAGE = 'taxas-dos-titulos-ofertados-pelo-tesouro-direto';
const TESOURO_CKAN_SEARCH =
  'https://www.tesourotransparente.gov.br/ckan/api/3/action/package_search?q=' +
  TESOURO_PACKAGE;

const PREFIXADO_TYPE = 'Tesouro Prefixado';
const PREFIXADO_MIN_MONTHS = 12;
const FIXED_ANNUAL_RATE = 1.06;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json, text/plain, */*',
};

export const CDI = 'CDI';
export const IBOV = 'IBOV';
export const RISK_FREE_BOND = 'Risk Free Bond';
export const FIXED_SIX = '6 % a.a.';

export type MonthlySeries = {[month: string]: number};

export interface Benchmarks {
  months: string[];
  series: {[name: string]: MonthlySeries};
}

function monthKey(year: number, month: number) {
  return `${year}-${month.toString().padStart(2, '0')}`;
}

function parseBrDate(value: string) {
  const parts = (value || '').split('/');
  if (parts.length !== 3) {
    return undefined;
  }
  const [day, month, year] = parts.map(p => parseInt(p, 10));
  if (!day || !month || !year) {
    return undefined;
  }
  return {year, month, day};
}

function toMonthly(annualRatePercent: number) {
  return Math.pow(1 + annualRatePercent / 100, 1 / 12) - 1;
}

async function fetchCdi(): Promise<MonthlySeries> {
  const result = await axios.get<{data: string; valor: string}[]>(BCB_CDI_URL, {
    headers: BROWSER_HEADERS,
  });

  const series: MonthlySeries = {};
  for (const point of result.data) {
    const date = parseBrDate(point.data);
    const value = parseFloat(point.valor);
    if (!date || !isFinite(value)) {
      continue;
    }
    series[monthKey(date.year, date.month)] = value / 100;
  }

  if (!Object.keys(series).length) {
    throw new Error('CDI vazio (BCB SGS 4391)');
  }
  return series;
}

async function fetchIbov(startYear: number): Promise<MonthlySeries> {
  const params = {
    index: 'IBOV',
    language: 'pt-br',
    dateInitial: `${startYear - 1}-01-01`,
    dateFinal: `${new Date().getFullYear() + 1}-12-31`,
  };
  const token = Buffer.from(JSON.stringify(params)).toString('base64');

  const result = await axios.get<
    {month: number; year: number; indexClosingRate: number}[]
  >(B3_MONTHLY_EVOLUTION + token, {headers: BROWSER_HEADERS});

  const levels = result.data
    .filter(p => isFinite(p.indexClosingRate) && p.indexClosingRate > 0)
    .map(p => ({key: monthKey(p.year, p.month), level: p.indexClosingRate}))
    .sort((a, b) => a.key.localeCompare(b.key));

  if (levels.length < 2) {
    throw new Error('IBOV vazio (B3 GetMonthlyEvolution)');
  }

  const series: MonthlySeries = {};
  for (let i = 1; i < levels.length; i++) {
    series[levels[i].key] = levels[i].level / levels[i - 1].level - 1;
  }
  return series;
}

async function resolveTesouroRateCsvUrl() {
  const result = await axios.get(TESOURO_CKAN_SEARCH, {
    headers: BROWSER_HEADERS,
  });
  const packages = result.data?.result?.results || [];

  for (const pkg of packages) {
    if (pkg.name !== TESOURO_PACKAGE) {
      continue;
    }
    for (const resource of pkg.resources || []) {
      if ((resource.format || '').toUpperCase() === 'CSV') {
        return resource.url as string;
      }
    }
  }

  throw new Error(`CSV de taxas nao encontrado no pacote ${TESOURO_PACKAGE}`);
}

async function fetchRiskFreeBond(): Promise<MonthlySeries> {
  const url = await resolveTesouroRateCsvUrl();
  const file = await axios.get<Buffer>(url, {
    responseType: 'arraybuffer',
    headers: BROWSER_HEADERS,
  });

  const firstSessions: {
    [month: string]: {day: number; offers: {maturity: number; rate: number}[]};
  } = {};

  Papa.parse<CsvType>(Buffer.from(file.data).toString('latin1'), {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
    step: results => {
      const row = results.data;
      if (row['Tipo Titulo'] !== PREFIXADO_TYPE) {
        return;
      }

      const rate = parseFloat(
        (row['Taxa Compra Manha'] || '').replace(',', '.'),
      );
      const base = parseBrDate(row['Data Base']);
      const maturity = parseBrDate(row['Data Vencimento']);
      if (!isFinite(rate) || !base || !maturity) {
        return;
      }

      const key = monthKey(base.year, base.month);
      const offer = {
        maturity: Date.UTC(maturity.year, maturity.month - 1, maturity.day),
        rate,
      };

      const session = firstSessions[key];
      if (!session || base.day < session.day) {
        firstSessions[key] = {day: base.day, offers: [offer]};
      } else if (base.day === session.day) {
        session.offers.push(offer);
      }
    },
    complete: () => {},
  });

  const series: MonthlySeries = {};
  for (const key of Object.keys(firstSessions)) {
    const [year, month] = key.split('-').map(Number);
    const floor = Date.UTC(year, month - 1 + PREFIXADO_MIN_MONTHS, 1);

    const eligible = firstSessions[key].offers.filter(o => o.maturity >= floor);
    if (!eligible.length) {
      continue;
    }

    const shortest = eligible.reduce((a, b) =>
      a.maturity <= b.maturity ? a : b,
    );
    series[key] = toMonthly(shortest.rate);
  }

  if (!Object.keys(series).length) {
    throw new Error('Risk Free Bond vazio (Tesouro Direto)');
  }
  return series;
}

export async function getBenchmarks(startYear: number): Promise<Benchmarks> {
  const [cdi, ibov, riskFreeBond] = await Promise.all([
    fetchCdi(),
    fetchIbov(startYear),
    fetchRiskFreeBond(),
  ]);

  const months = Array.from(
    new Set([
      ...Object.keys(cdi),
      ...Object.keys(ibov),
      ...Object.keys(riskFreeBond),
    ]),
  )
    .filter(m => parseInt(m.substring(0, 4), 10) >= startYear)
    .sort()
    .reverse();

  const fixedSix: MonthlySeries = {};
  const fixedMonthly = Math.pow(FIXED_ANNUAL_RATE, 1 / 12) - 1;
  for (const month of months) {
    fixedSix[month] = fixedMonthly;
  }

  return {
    months,
    series: {
      [CDI]: cdi,
      [IBOV]: ibov,
      [RISK_FREE_BOND]: riskFreeBond,
      [FIXED_SIX]: fixedSix,
    },
  };
}
