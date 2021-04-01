"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = void 0;
/* eslint-disable no-debugger */
const axios_1 = require("axios");
const AdmZip = require("adm-zip");
const cacaache = require("cacache");
const Papa = require("papaparse");
const _ = require("lodash");
async function getCachedFile(url) {
    const file = await cacaache.get.info('.cache', url);
    if (!file) {
        try {
            const result = await axios_1.default.get(url, {
                responseType: 'arraybuffer',
            });
            await cacaache.put('.cache', url, result.data);
        }
        catch (ex) {
            debugger;
        }
    }
    return await (await cacaache.get('.cache', url)).data;
}
async function getYear(year) {
    const fileUrl = `http://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/HIST/inf_diario_fi_${year}.zip`;
    const file = await getCachedFile(fileUrl);
    const zip = new AdmZip(file);
    const zipEntries = zip.getEntries();
    const finalObject = {};
    for (const entry of zipEntries) {
        //const month = entry.name.replace(/\D+/g, '');
        const result = Papa.parse(entry.getData().toString(), {
            header: true,
            delimiter: ';',
        });
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
            finalObject[cnpj][fundo['DT_COMPTC'].substring(0, 7)] = parseFloat(fundo['VL_QUOTA']);
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
async function run() {
    const currentYear = new Date().getFullYear();
    for (let year = currentYear; year >= currentYear - 10; year--) {
        const yearObj = await getYear(year);
    }
}
exports.run = run;
//# sourceMappingURL=fundos.js.map