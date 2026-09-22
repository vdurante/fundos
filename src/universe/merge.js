'use strict';

/**
 * Stage 2. Turn per-platform records into the tracked universe.
 *
 * Reads only the normalized record shape, so it knows no platform's field names and
 * adding a platform never edits this file. Three admission rules, all universal:
 *
 *   onShelf                 the platform sells it, not merely lists it
 *   !master                 a wholesale vehicle is shared by every feeder above it, so
 *                           it cannot identify one product and its quota series is
 *                           gross of the feeder's fee
 *   situacao === OPERATING  "listed" is only as fresh as the crawl; the registry is
 *                           what stops a stale snapshot asserting a dead fund is
 *                           purchasable
 *
 * A record with no CNPJ cannot enter, and is counted rather than dropped in silence.
 */

const {OPERATING} = require('../lib/cvm-registry');

const admissible = r => r.onShelf && !r.master && r.situacao === OPERATING;

function merge(records) {
  const byPlatform = {};
  const rejected = [];
  const universe = new Map();

  for (const r of records) {
    const p = (byPlatform[r.platform] = byPlatform[r.platform] || {
      listed: 0, entered: 0, noCnpj: 0, offShelf: 0, master: 0, notOperating: 0,
    });
    p.listed++;

    if (!r.onShelf) {
      p.offShelf++;
      continue;
    }
    if (!r.cnpj) {
      p.noCnpj++;
      rejected.push({...r, why: 'no-cnpj'});
      continue;
    }
    if (r.master) {
      p.master++;
      rejected.push({...r, why: 'master'});
      continue;
    }
    if (r.situacao !== OPERATING) {
      p.notOperating++;
      rejected.push({...r, why: `situacao:${r.situacao}`});
      continue;
    }

    p.entered++;
    const seen = universe.get(r.cnpj);
    if (seen) {
      if (!seen.platforms.includes(r.platform)) seen.platforms.push(r.platform);
      seen.keys.push(r.key);
    } else {
      universe.set(r.cnpj, {
        cnpj: r.cnpj,
        name: r.officialName || r.name,
        platforms: [r.platform],
        keys: [r.key],
        resolution: r.resolution,
      });
    }
  }

  return {
    funds: [...universe.values()].sort((a, b) => a.cnpj.localeCompare(b.cnpj)),
    byPlatform,
    rejected,
  };
}

module.exports = {merge, admissible, OPERATING};
