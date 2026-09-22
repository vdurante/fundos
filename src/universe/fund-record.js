'use strict';

/**
 * The one shape the merger understands, and the only place a source's own field
 * names appear. Adding a platform means adding an adapter here and nothing else.
 *
 *   key           '<PLATFORM>#<id>' — the override store's key, stable per platform
 *   platform      ITAU | ITAU_PREV | ONZE
 *   id            the platform's own stable id for the fund
 *   name          the platform's commercial name, as sold
 *   hint          human-readable disambiguator for the override file (may be null)
 *   cnpj          null when the crawl could not identify it
 *   officialName  the CVM registry name, when a CNPJ was resolved
 *   situacao      the CVM registry status, when a CNPJ was resolved
 *   resolution    which rule identified it, or why it was not identified
 *   onShelf       the platform actually sells it (not merely lists it)
 *   master        the CVM name says MASTER — a wholesale vehicle, never investable
 */

const path = require('path');
const {format} = require('../lib/cnpj');

const DATA = path.join(__dirname, '..', 'corretoras');

const read = file => require(path.join(DATA, file));

const record = r => ({
  key: `${r.platform}#${r.id}`,
  platform: r.platform,
  id: String(r.id),
  name: r.name,
  hint: r.hint ?? null,
  cnpj: r.cnpj ? format(r.cnpj) : null,
  officialName: r.officialName ?? null,
  situacao: r.situacao ?? null,
  resolution: r.resolution ?? null,
  onShelf: r.onShelf !== false,
  master: r.master === true,
});

const ADAPTERS = {
  ITAU: () =>
    read('itau-documents.json').map(f =>
      record({
        platform: 'ITAU',
        id: f.codigoProduto,
        name: f.nomeComercial,
        cnpj: f.cnpj,
        officialName: f.nomeOficial,
        situacao: f.situacao,
        resolution:
          f.resolution ||
          (f.absence === 'blocked' ? 'fetch-blocked' : 'no-document-anywhere'),
      }),
    ),

  ITAU_PREV: () =>
    read('itau-prev-funds.json').map(f =>
      record({
        platform: 'ITAU_PREV',
        id: f.cnpj,
        name: f.nomeFundo,
        cnpj: f.cnpj,
        officialName: f.nomeOficial,
        situacao: f.situacao,
        resolution: f.cnpj ? 'opin-published' : null,
        onShelf: f.onShelf,
        master: f.master,
      }),
    ),

  ONZE: () =>
    read('onze-funds.json').map(f =>
      record({
        platform: 'ONZE',
        id: f.id,
        name: f.name,
        hint: f.slug,
        cnpj: f.cnpj,
        officialName: f.nomeOficial,
        situacao: f.situacao,
        resolution: f.resolution,
      }),
    ),
};

const PLATFORMS = Object.keys(ADAPTERS);

function collect() {
  const out = [];
  for (const platform of PLATFORMS) out.push(...ADAPTERS[platform]());
  return out;
}

module.exports = {ADAPTERS, PLATFORMS, collect, record};
