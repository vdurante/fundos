const MASTER_RE = /\bMASTER\b/i;

const isMaster = (name: unknown) => MASTER_RE.test(String(name));

const digits = (cnpj: unknown) => String(cnpj).replace(/\D/g, '');

const format = (cnpj: unknown) =>
  digits(cnpj).replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5',
  );

function validCnpj(formatted: unknown) {
  const d = digits(formatted);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    let w = len - 7;
    for (let i = 0; i < len; i++) {
      sum += Number(d[i]) * w--;
      if (w < 2) w = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

const NAME_STOPWORDS = new Set([
  'fundo',
  'fundos',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'em',
  'e',
  'investimento',
  'investimentos',
  'cotas',
  'fi',
  'fic',
  'fim',
  'fif',
  'cic',
  'rf',
  'mm',
  'cp',
  'lp',
  'ie',
  'rl',
  'resp',
  'responsabilidade',
  'limitada',
  'a',
  'o',
  'the',
  'multimercado',
  'multimercados',
  'acoes',
  'ações',
  'renda',
  'fixa',
  'credito',
  'crédito',
  'privado',
  'longo',
  'prazo',
  'prev',
  'subclasse',
  'classe',
  'i',
  'ii',
  'iii',
  'financeiro',
]);

const nameWords = (s: unknown) =>
  new Set(
    String(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2 && !NAME_STOPWORDS.has(w)),
  );

const sharedWords = (a: unknown, b: unknown) => {
  const wb = nameWords(b);
  return [...nameWords(a)].filter(w => wb.has(w));
};

export {
  isMaster,
  validCnpj,
  digits,
  format,
  nameWords,
  sharedWords,
  NAME_STOPWORDS,
};
