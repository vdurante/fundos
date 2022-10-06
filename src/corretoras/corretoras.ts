import axios from 'axios';
import * as fs from 'fs';
import {request} from 'http';
import * as puppeteer from 'puppeteer';

interface Fundo {
  cnpj: string;
}

async function writeCnpjs(corretora: string, fundos: Fundo[]) {
  if (!fundos) {
    console.error(`${corretora} NÃO populado`);
  }
  const cnpjs = JSON.stringify(
    fundos.map(p => p.cnpj),
    null,
    2
  );

  fs.writeFileSync(`./src/corretoras/${corretora}.json`, cnpjs);
  fs.writeFileSync(`${__dirname}/${corretora}.json`, cnpjs);

  console.log(`${corretora} populado`);
}

async function btg() {
  const result = await axios.get<Fundo[]>(
    'https://www.btgpactualdigital.com/services/api/funds-public/public/B2C'
  );

  await writeCnpjs('btg', result.data);
}

async function xp() {
  const browser = await puppeteer.launch({
    headless: false,
  });
  const page = await browser.newPage();
  let xpData: Fundo[] = [];

  page.setRequestInterception(true);

  page.on('request', async request => {
    if (request.resourceType() === 'image') {
      await request.abort();
    } else {
      await request.continue();
    }
  });

  page.on('requestfinished', async request => {
    if (
      request
        .url()
        .startsWith(
          'https://api.xpi.com.br/investment-funds/yield-portal/v2/investment-funds'
        )
    ) {
      const response = request.response();

      if (!response) {
        return;
      }

      if (request.redirectChain().length !== 0) {
        return;
      }

      try {
        const responseBody = (await response.buffer()).toString();
        xpData = JSON.parse(responseBody).data;
      } catch (ex) {
        // ignore preflight exception
      }
    }
  });
  await page.goto(
    'https://www.xpi.com.br/investimentos/fundos-de-investimento/lista/#/',
    {
      waitUntil: 'networkidle0',
    }
  );
  await browser.close();

  await writeCnpjs('xp', xpData);
}

export async function run() {
  await btg();
  await xp();
}
