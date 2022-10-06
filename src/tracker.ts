import * as xpAuto from './corretoras/xp.json';
import * as xpManual from './corretoras/xp-manual.json';

import * as btgAuto from './corretoras/btg.json';
import * as btgManual from './corretoras/btg-manual.json';

import * as cnpjAuto from './corretoras/cnpj.json';
import * as cnpjManual from './corretoras/cnpj-manual.json';

const xp = xpAuto.concat(xpManual);
const btg = btgAuto.concat(btgManual);
const cnpj = cnpjAuto.concat(Object.keys(cnpjManual));

// $..cnpj
export const XP_FUNDOS = xp.map(p =>
  p
    .replace(/\D+/g, '')
    .replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
);

// $..cnpj
export const BTG_FUNDOS = btg.map(p =>
  p
    .replace(/\D+/g, '')
    .replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
);

export const MANUAL_FUNDOS = cnpj.map(p =>
  p
    .replace(/\D+/g, '')
    .replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
);

export const CNPJ_FUNDOS = [
  ...XP_FUNDOS,
  ...BTG_FUNDOS,
  ...MANUAL_FUNDOS,
].filter((v, i, a) => a.indexOf(v) === i);

const fundosObj = CNPJ_FUNDOS.reduce(
  (acc, curr) => ((acc[curr] = true), acc),
  {} as {[key: string]: boolean}
);

export function isTracked(cnpj: string) {
  return cnpj in fundosObj;
}

export const CNPJ_MANUAL = cnpjManual;
