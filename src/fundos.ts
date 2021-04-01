/* eslint-disable no-debugger */
import axios from 'axios';
import * as AdmZip from 'adm-zip';
import * as parse from 'csv-parse/lib/index';
import * as cacaache from 'cacache';
import * as Papa from 'papaparse';
import * as _ from 'lodash';

async function getCachedFile(url: string) {
  const file = await cacaache.get.info('.cache', url);
  if (!file) {
    try {
      const result = await axios.get(url, {
        responseType: 'arraybuffer',
      });

      await cacaache.put('.cache', url, result.data);
    } catch (ex) {
      if (ex.response.status === 404) {
        return undefined;
      }
      throw ex;
    }
  }
  return await (await cacaache.get('.cache', url)).data;
}

async function getYearFromCsv(year: number) {
  const fileUrl = `http://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/HIST/inf_diario_fi_${year}.zip`;

  const file = await getCachedFile(fileUrl);

  if (!file) {
    return undefined;
  }

  const zip = new AdmZip(file);
  const zipEntries = zip.getEntries();

  const finalObject: any = {};

  for (const entry of zipEntries) {
    //const month = entry.name.replace(/\D+/g, '');

    const result = Papa.parse<{[key: string]: string}>(
      entry.getData().toString(),
      {
        header: true,
        delimiter: ';',
      }
    );

    const fundos = _(result.data)
      .filter(e => !!e['CNPJ_FUNDO'])
      .groupBy('CNPJ_FUNDO')
      .mapValues(a => {
        return _.maxBy(a, 'DT_COMPTC') || {};
      })
      .value();

    for (const cnpj in fundos) {
      const fundo = fundos[cnpj];
      if (!finalObject[cnpj]) {
        finalObject[cnpj] = {};
      }
      finalObject[cnpj][fundo['DT_COMPTC'].substring(0, 7)] = parseFloat(
        fundo['VL_QUOTA']
      );
    }
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
    //.value();
    // .mapValues(a => {
    //   console.log(a);
    //   return a;
    // });
  }
}

async function getYearFromZip(year: number) {
  const fileUrl = `http://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/HIST/inf_diario_fi_${year}.zip`;

  const file = await getCachedFile(fileUrl);

  if (!file) {
    return undefined;
  }

  const zip = new AdmZip(file);
  const zipEntries = zip.getEntries();

  const finalObject: any = {};

  for (const entry of zipEntries) {
    //const month = entry.name.replace(/\D+/g, '');

    const result = Papa.parse<{[key: string]: string}>(
      entry.getData().toString(),
      {
        header: true,
        delimiter: ';',
      }
    );

    const fundos = _(result.data)
      .filter(e => !!e['CNPJ_FUNDO'])
      .groupBy('CNPJ_FUNDO')
      .mapValues(a => {
        return _.maxBy(a, 'DT_COMPTC') || {};
      })
      .value();

    for (const cnpj in fundos) {
      const fundo = fundos[cnpj];
      if (!finalObject[cnpj]) {
        finalObject[cnpj] = {};
      }
      finalObject[cnpj][fundo['DT_COMPTC'].substring(0, 7)] = parseFloat(
        fundo['VL_QUOTA']
      );
    }
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
    //.value();
    // .mapValues(a => {
    //   console.log(a);
    //   return a;
    // });
  }
}

export async function run() {
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= currentYear - 10; year--) {
    const yearObj =
      (await getYearFromZip(year)) || (await getYearFromCsv(year));
    if (!yearObj) {
      throw new Error('Falha ao baixar ano');
    }
  }
}
