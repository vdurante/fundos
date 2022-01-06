/* eslint-disable no-debugger */
import axios from 'axios';
import * as AdmZip from 'adm-zip';
import * as parse from 'csv-parse/lib/index';
import * as cacache from 'cacache';
import * as Papa from 'papaparse';
import * as _ from 'lodash';
import {isTracked} from '../tracker';
import {GoogleSpreadsheet} from 'google-spreadsheet';
import {off} from 'node:process';
import {CsvType, getFile, range} from '../shared';

async function parseCsv(buffer: Buffer): Promise<CsvType[]> {
  const data: CsvType[] = [];

  Papa.parse<CsvType>(buffer.toString('latin1'), {
    header: true,
    delimiter: ';',
    worker: true,
    skipEmptyLines: true,
    step: (results, parser) => {
      if (isTracked(results.data['CNPJ_FUNDO'])) {
        data.push(results.data as any);
      }
    },
  });

  return data;
}

async function getCadastrosFomCsv() {
  const data: CsvType[] = [];

  const fileUrl = 'http://dados.cvm.gov.br/dados/FI/CAD/DADOS/cad_fi.csv';
  //const fileUrl = 'http://dados.cvm.gov.br/dados/FI/DOC/EXTRATO/DADOS/extrato_fi.csv';

  const file = await getFile(fileUrl);

  if (!file) {
    throw new Error('Arquivo de cadastro nao localizado');
  }

  return await parseCsv(file);
}

export async function getCadastros(): Promise<CsvType[]> {
  const cache = await cacache.get.info('.cache', 'cadastros');

  if (!cache || !!process.env.CACHE_CADASTROS === false) {
    const temp = await getCadastrosFomCsv();

    if (!temp) {
      throw new Error('Falha ao buscar cadastros');
    }

    await cacache.put('.cache', 'cadastros', JSON.stringify(temp));
  }
  const cadastros = JSON.parse(
    await (await cacache.get('.cache', 'cadastros')).data.toString()
  ) as CsvType[];

  const replacers = [
    {
      from: [/\s+/g],
      to: ' ',
    },
    {
      from: [
        /FUNDOS? (DE )?INVESTIMENTO/g,
        /FUNDOS? INCENTIVADOS? (DE )?INVESTIMENTO/g,
        /FUNDOS? (DE )?INVESTIMENTO INCENTIVADOS?/g,
      ],
      to: 'FI',
    },
    {
      from: [/FI (EM\s+|DE\s+)?(COTAS|QUOTAS)(\s+DE)?/g, /FIC DE/g],
      to: 'FIC',
    },
    {
      from: [/FI (EM\s|DE\s)?A(ÇÕ|CO)ES/g],
      to: 'FIA',
    },
    {
      from: [/FI MULTIMERCADO/g, /MULTIMERCADO FI/g],
      to: 'FIM',
    },
    {
      from: [/FI (EM\s|DE\s)?RENDA FIXA/g],
      to: 'FIRF',
    },
    {
      from: [/DEB(E|Ê)NTURES INCENTIVADAS?/g],
      to: 'DI',
    },
    {
      from: [/INVEST(IMENTO)?S? (NO )?EXT(ERIOR)?/g],
      to: 'IE',
    },
    {from: ['CRÉDITO PRIVADO', 'CREDITO PRIVADO'], to: 'CrePri'},
    {from: ['LONGO PRAZO', 'LONGO PRA'], to: 'LPrz'},
    {from: ['CURTO PRAZO'], to: 'CPrz'},
    {from: ['RENDA FIXA'], to: 'RF'},
  ];

  cadastros.map(p => {
    for (const replacer of replacers) {
      for (const from of replacer['from']) {
        //if (p['CNPJ_FUNDO'] === '19.821.469/0001-10') debugger;
        p['DENOM_SOCIAL'] = p['DENOM_SOCIAL'].replace(from, replacer['to']);
      }
    }
  });

  return cadastros;
}
