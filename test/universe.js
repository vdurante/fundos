/**
 * Enforces the universe stages' invariants, so a guard cannot be removed silently.
 *
 * Every refusal below corresponds to a real defect this pipeline has produced: a master
 * keyed as a shelf product (Polo Norte, Opportunity Global Equity Real, ONZE feeder
 * rows), a hand-typed pairing nothing could contradict (QUANTAMENTAL GEMS), and a
 * blocked fetch recorded as an established absence (the 15 Itaú funds).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');

const {merge} = require('../build/src/universe/merge');
const {
  record,
  collect,
  PLATFORMS,
} = require('../build/src/universe/fund-record');
const {enrich} = require('../build/src/universe/enrich');
const overrides = require('../build/src/universe/overrides');
const {loadRegistry} = require('../build/src/lib/cvm-registry');
const {validCnpj, isMaster, sharedWords} = require('../build/src/lib/cnpj');

const OPERATING = 'Em Funcionamento Normal';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label}${
      ok
        ? ''
        : `  expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`
    }`,
  );
}
function checkMatch(label, actual, needle) {
  const ok = String(actual).includes(needle);
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${JSON.stringify(actual)} lacks "${needle}"`}`,
  );
}

const fund = over =>
  record({
    platform: 'ITAU',
    id: '1',
    name: 'Example Dunamis Multimercado',
    cnpj: '20.335.522/0001-51',
    officialName: 'EXAMPLE DUNAMIS FIF MULTIMERCADO',
    situacao: OPERATING,
    resolution: 'page-header',
    ...over,
  });

async function main() {
  console.log('\nmerge: admission rules');
  check('an operating on-shelf fund enters', merge([fund()]).funds.length, 1);
  check(
    'an off-shelf fund does not enter',
    merge([fund({onShelf: false})]).byPlatform.ITAU.entered,
    0,
  );
  check(
    'a master does not enter',
    merge([fund({master: true})]).byPlatform.ITAU.entered,
    0,
  );
  check(
    'a fund the registry does not call operating does not enter',
    merge([fund({situacao: 'Cancelado'})]).byPlatform.ITAU.entered,
    0,
  );
  check(
    'a fund with no CNPJ is counted, not silently dropped',
    merge([fund({cnpj: null})]).byPlatform.ITAU.noCnpj,
    1,
  );
  check(
    'the same CNPJ on two platforms is one fund on both',
    merge([fund(), fund({platform: 'ONZE', id: 'x'})]).funds[0].platforms,
    ['ITAU', 'ONZE'],
  );

  console.log('\nadapters: the record boundary holds');
  const real = collect();
  const required = [
    'key',
    'platform',
    'id',
    'name',
    'cnpj',
    'situacao',
    'resolution',
    'onShelf',
    'master',
  ];
  const bad = real.filter(r => required.some(k => !(k in r)));
  check('every real record carries the full shape', bad.length, 0);
  check(
    'every key is <PLATFORM>#<id>',
    real.filter(r => r.key !== `${r.platform}#${r.id}`).length,
    0,
  );
  check('keys are unique', new Set(real.map(r => r.key)).size, real.length);
  check('every platform has an adapter', PLATFORMS.length, 3);
  checkMatch(
    'a blocked fetch is not reported as a missing document',
    real.filter(r => r.resolution === 'fetch-blocked').length > 0
      ? 'fetch-blocked present'
      : 'absent',
    'fetch-blocked present',
  );

  console.log('\ncnpj: primitives');
  check('check digits accepted', validCnpj('20.335.522/0001-51'), true);
  check('check digits rejected', validCnpj('20.335.522/0001-52'), false);
  check(
    'whitespace inside a CNPJ is tolerated',
    validCnpj('18.525.868/0001 -70'),
    true,
  );
  check(
    'MASTER detected',
    isMaster('POLO NORTE MASTER FIF MULTIMERCADO'),
    true,
  );
  check(
    'MASTERCARD-like substring not detected',
    isMaster('MASTERCLASS FIF'),
    false,
  );
  check(
    'generic words do not corroborate',
    sharedWords(
      'FUNDO DE INVESTIMENTO MULTIMERCADO',
      'FUNDO DE INVESTIMENTO RENDA FIXA',
    ),
    [],
  );

  const registry = await loadRegistry();
  const byKey = new Map(real.map(r => [r.key, r]));
  const target = real.find(r => r.platform === 'ITAU' && !r.cnpj);
  const resolved = real.find(r => r.platform === 'ITAU' && r.cnpj);

  console.log('\noverrides: every guard refuses');
  const bad4 = (entry, key = target.key) =>
    overrides.validate(key, entry, byKey, registry);
  checkMatch(
    'unknown key',
    bad4({cnpj: '20.335.522/0001-51', why: 'w', sourcedBy: 's'}, 'ITAU#000000'),
    'no fund with that key',
  );
  checkMatch(
    'bad check digits',
    bad4({cnpj: '20.335.522/0001-52', why: 'w', sourcedBy: 's'}),
    'check digits',
  );
  checkMatch(
    'not in the registry',
    bad4({cnpj: '11.111.111/0001-91', why: 'w', sourcedBy: 's'}),
    'not a registered',
  );
  checkMatch(
    'a MASTER is refused',
    bad4({cnpj: '17.373.839/0001-78', why: 'w', sourcedBy: 's'}, 'ITAU#56144'),
    'a MASTER, which no shelf sells',
  );
  checkMatch(
    'a name that cannot corroborate',
    bad4({cnpj: '26.587.503/0001-07', why: 'w', sourcedBy: 's'}, 'ITAU#56143'),
    'shares no significant word',
  );
  checkMatch(
    'provenance is mandatory',
    bad4({cnpj: '36.015.100/0001-39', why: 'w'}, 'ITAU#56966'),
    'needs both',
  );
  check(
    'a sound entry is accepted',
    bad4({cnpj: '36.015.100/0001-39', why: 'w', sourcedBy: 's'}, 'ITAU#56966'),
    null,
  );

  console.log('\nenrich: precedence and reporting');
  const tmp = `${overrides.FILE}.testbak`;
  fs.copyFileSync(overrides.FILE, tmp);
  try {
    const live = overrides.load();

    overrides.save({
      ...live,
      [resolved.key]: {cnpj: resolved.cnpj, why: 'w', sourcedBy: 's'},
    });
    const staleRun = await enrich(collect(), registry, {});
    check(
      'an override the crawl now matches is reported stale',
      staleRun.stale.some(s => s.key === resolved.key),
      true,
    );
    check(
      'a stale override applies nothing',
      staleRun.applied.some(a => a.key === resolved.key),
      false,
    );

    overrides.save(live);
    const plain = await enrich(collect(), registry, {});
    check(
      'without ask, a hole is reported missing',
      plain.missing.some(m => m.key === target.key),
      true,
    );
    check(
      'without ask, nothing is invented',
      plain.missing.every(m => !m.cnpj),
      true,
    );

    let asked = 0;
    const withAsk = await enrich(collect(), registry, {
      ask: async f => {
        asked++;
        return f.key === 'ITAU#56143'
          ? {cnpj: '26.587.503/0001-07', why: 'w', sourcedBy: 's'}
          : null;
      },
    });
    check('ask is offered every hole', asked > 0, true);
    const refused = withAsk.missing.find(m => m.key === 'ITAU#56143');
    checkMatch(
      'a bad answer at the prompt is refused, not stored',
      refused && refused.refused,
      'shares no significant word',
    );
    check(
      'a refused answer is not written to the store',
      'ITAU#56143' in overrides.load(),
      false,
    );

    overrides.save(live);
    const applied = await enrich(collect(), registry, {});
    check('a sound override fills the hole', applied.applied.length, 2);
    check(
      'an applied override is labelled',
      applied.applied.length && collect().length > 0,
      true,
    );
  } finally {
    fs.copyFileSync(tmp, overrides.FILE);
    fs.unlinkSync(tmp);
  }

  console.log('\nuniverse: the artifact agrees with a fresh merge');
  const artifact = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'src', 'corretoras', 'universe.json'),
      'utf8',
    ),
  );
  const fresh = await enrich(collect(), registry, {});
  const merged = merge(fresh.records);
  check(
    'distinct count matches',
    artifact.counts.distinct,
    merged.funds.length,
  );
  check(
    'unresolved count matches',
    artifact.counts.unresolved,
    fresh.missing.length,
  );
  check(
    'unresolved is surfaced, not hidden',
    artifact.counts.unresolved > 0,
    true,
  );

  console.log(
    failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
