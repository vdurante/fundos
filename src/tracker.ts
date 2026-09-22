import * as xpAuto from './corretoras/xp.json';
import * as xpManual from './corretoras/xp-manual.json';

import * as btgAuto from './corretoras/btg.json';
import * as btgManual from './corretoras/btg-manual.json';

const xp = xpAuto.concat(xpManual);
const btg = btgAuto.concat(btgManual);

const format = (cnpj: string) =>
  cnpj
    .replace(/\D+/g, '')
    .replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');

// $..cnpj
export const XP_FUNDOS = xp.map(format);

// $..cnpj
export const BTG_FUNDOS = btg.map(format);

export const CNPJ_FUNDOS = [...XP_FUNDOS, ...BTG_FUNDOS].filter(
  (v, i, a) => a.indexOf(v) === i
);

const fundosObj = CNPJ_FUNDOS.reduce(
  (acc, curr) => ((acc[curr] = true), acc),
  {} as {[key: string]: boolean}
);

export function isTracked(cnpj: string) {
  return cnpj in fundosObj;
}
