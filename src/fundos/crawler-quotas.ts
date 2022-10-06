import * as AdmZip from 'adm-zip';
import * as parse from 'csv-parse/lib/index';
import * as cacache from 'cacache';
import * as Papa from 'papaparse';
import * as _ from 'lodash';
import {isTracked} from '../tracker';
import {GoogleSpreadsheet} from 'google-spreadsheet';
import {off} from 'node:process';
import {CsvType, getFile, range} from '../shared';

async function getYear(year: number): Promise<CsvType[]> {
  const cache = await cacache.get.info('.cache', year.toString());

  if (!cache || !!process.env.CACHE_YEAR === false) {
    const temp =
      (await getYearFromHistory(year)) || (await getYearFromMonthReports(year));

    if (!temp) {
      throw new Error('Falha ao buscar ano');
    }

    await cacache.put('.cache', year.toString(), JSON.stringify(temp));
  }
  return JSON.parse(
    (await cacache.get('.cache', year.toString())).data.toString()
  );
}

async function parseCsv(buffer: Buffer): Promise<CsvType[]> {
  const data: CsvType[] = [];

  Papa.parse<CsvType>(buffer.toString(), {
    header: true,
    delimiter: ';',
    worker: true,
    skipEmptyLines: true,
    step: (results, parser) => {
      if (isTracked(results.data['CNPJ_FUNDO'])) {
        data.push(results.data as any);
      }
    },
    complete: () => {},
  });

  return data;

  // const fundos = _(data)
  //   //.filter(e => isTracked(e['CNPJ_FUNDO']))
  //   .groupBy('CNPJ_FUNDO')
  //   .mapValues(a => {
  //     return _.maxBy(a, 'DT_COMPTC') || {};
  //   })
  //   .value();

  // for (const cnpj in fundos) {
  //   const fundo = fundos[cnpj];
  //   if (!finalObject[cnpj]) {
  //     finalObject[cnpj] = {};
  //   }
  //   finalObject[cnpj][fundo['DT_COMPTC'].substring(0, 7)] = parseFloat(
  //     fundo['VL_QUOTA']
  //   );
  // }
}

/**
 * Fetches a whole year split by month from http://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS
 * This method is deprecated since quotas are not available as CSV anymore, only zips
 * @param year the year
 * @returns all csvs of the year concatenated
 */
/** @deprecated */
async function getYearFromCsv(year: number) {
  let maxMonth = 12;
  if (year === new Date().getFullYear()) {
    maxMonth = new Date().getMonth();
  }

  let data: CsvType[] = [];

  for (const month of range(1, maxMonth + 1, 1)) {
    const fileUrl = `http://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_${year}${month
      .toString()
      .padStart(2, '0')}.csv`;

    const file = await getFile(fileUrl);

    if (!file) {
      throw new Error('Mes nao encontrado');
    }

    //const month = entry.name.replace(/\D+/g, '');
    data = data.concat(await parseCsv(file));
  }

  return data;

  // const fundos = _(data)
  //   //.filter(e => isTracked(e['CNPJ_FUNDO']))
  //   .groupBy('CNPJ_FUNDO')
  //   .mapValues(a => {
  //     return _.maxBy(a, 'DT_COMPTC') || {};
  //   })
  //   .value();

  // for (const cnpj in fundos) {
  //   const fundo = fundos[cnpj];
  //   if (!finalObject[cnpj]) {
  //     finalObject[cnpj] = {};
  //   }
  //   finalObject[cnpj][fundo['DT_COMPTC'].substring(0, 7)] = parseFloat(
  //     fundo['VL_QUOTA']
  //   );
  // }
  // .mapValues(a =>
  //   _(a)
  //     .groupBy(e => {
  //       //console.log(e['DT_COMPTC']);
  //       try {
  //         return e['DT_COMPTC'].substring(0, 7);
  //       } catch (ex) {
  //         console.error(ex);
  //         console.log(e);
  //         throw ex;
  //       }
  //     })
  //     .value()
  // )
  // .value();
  // .mapValues(a => {
  //   console.log(a);
  //   return a;
  // });
  //}
  //return finalObject;
}

/**
 * Fetches a whole year split by month from http://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS
 * @param year the year
 * @returns all csvs of the year concatenated
 */
async function getYearFromMonthReports(year: number) {
  let maxMonth = 12;
  if (year === new Date().getFullYear()) {
    maxMonth = new Date().getMonth();
  }

  let data: CsvType[] = [];

  for (const month of range(1, maxMonth + 1, 1)) {
    const monthString = month.toString().padStart(2, '0');
    const fileUrl = `http://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_${year}${monthString}.zip`;

    const file = await getFile(fileUrl);

    if (!file) {
      throw new Error('Mes nao encontrado');
    }

    const zip = new AdmZip(file);
    const zipEntries = zip.getEntries();

    for (const entry of zipEntries) {
      data = data.concat(await parseCsv(entry.getData()));
    }
  }

  return data;
}

/**
 * Fetches a whole year from yearly zip found in http://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/HIST
 * @param year the year
 * @returns all csvs of the year concatenated
 */
async function getYearFromHistory(year: number) {
  const fileUrl = `http://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/HIST/inf_diario_fi_${year}.zip`;

  const file = await getFile(fileUrl);

  if (!file) {
    return undefined;
  }

  const zip = new AdmZip(file);
  const zipEntries = zip.getEntries();

  let data: CsvType[] = [];

  for (const entry of zipEntries) {
    //const month = entry.name.replace(/\D+/g, '');

    data = data.concat(await parseCsv(entry.getData()));
  }

  return data;
}

export async function getQuotas(endYear: number, startYear: number) {
  let data: CsvType[] = [];

  for (const year of range(endYear, startYear, -1)) {
    console.log(year);
    const yearArr = await getYear(year);
    if (!yearArr || !yearArr.length) {
      throw new Error('Falha ao baixar ano');
    }
    data = data.concat(yearArr);
  }

  return data;
}

export async function getQuotasMonthly(endYear: number, startYear: number) {
  const fundos = {};

  for (const year of range(endYear, startYear, -1)) {
    const yearObj = await getYear(year);

    _.mergeWith(fundos, yearObj, (value, srcValue) => {
      if (value) {
        return _.assign(value, srcValue);
      } else {
        return srcValue;
      }
    });

    if (!yearObj) {
      throw new Error('Falha ao baixar ano');
    }
  }

  return fundos;
}
