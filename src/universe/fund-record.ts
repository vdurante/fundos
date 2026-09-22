/**
 * The one shape the merger understands, and the only place a source's own field
 * names appear. Adding a platform means adding an adapter here and nothing else.
 */

import * as fs from 'fs';
import {format} from '../lib/cnpj';
import {dataFile} from '../lib/paths';
import {FundRecord, Platform, Resolution} from './types';

const read = (file: string): Record<string, unknown>[] =>
  JSON.parse(fs.readFileSync(dataFile(file), 'utf8'));

const str = (v: unknown): string | null =>
  v === undefined || v === null || v === '' ? null : String(v);

interface RecordInput {
  platform: Platform;
  id: string | number;
  name: string;
  hint?: string | null;
  cnpj?: unknown;
  officialName?: unknown;
  situacao?: unknown;
  resolution?: Resolution | null;
  onShelf?: boolean;
  master?: boolean;
}

export const record = (r: RecordInput): FundRecord => ({
  key: `${r.platform}#${r.id}`,
  platform: r.platform,
  id: String(r.id),
  name: r.name,
  hint: r.hint ?? null,
  cnpj: r.cnpj ? format(String(r.cnpj)) : null,
  officialName: str(r.officialName),
  situacao: str(r.situacao),
  resolution: r.resolution ?? null,
  onShelf: r.onShelf !== false,
  master: r.master === true,
});

type Adapter = () => FundRecord[];

export const ADAPTERS: Record<Platform, Adapter> = {
  ITAU: () =>
    read('itau-documents.json').map(f =>
      record({
        platform: 'ITAU',
        id: f.codigoProduto as number,
        name: String(f.nomeComercial),
        cnpj: f.cnpj,
        officialName: f.nomeOficial,
        situacao: f.situacao,
        resolution:
          (f.resolution as Resolution) ??
          (f.absence === 'blocked' ? 'fetch-blocked' : 'no-document-anywhere'),
      }),
    ),

  ITAU_PREV: () =>
    read('itau-prev-funds.json').map(f =>
      record({
        platform: 'ITAU_PREV',
        id: String(f.cnpj),
        name: String(f.nomeFundo),
        cnpj: f.cnpj,
        officialName: f.nomeOficial,
        situacao: f.situacao,
        resolution: f.cnpj ? 'opin-published' : null,
        onShelf: f.onShelf as boolean,
        master: f.master as boolean,
      }),
    ),

  ONZE: () =>
    read('onze-funds.json').map(f =>
      record({
        platform: 'ONZE',
        id: String(f.id),
        name: String(f.name),
        hint: f.slug as string,
        cnpj: f.cnpj,
        officialName: f.nomeOficial,
        situacao: f.situacao,
        resolution: f.resolution as Resolution,
      }),
    ),
};

export const PLATFORMS = Object.keys(ADAPTERS) as Platform[];

export function collect(): FundRecord[] {
  const out: FundRecord[] = [];
  for (const platform of PLATFORMS) out.push(...ADAPTERS[platform]());
  return out;
}
