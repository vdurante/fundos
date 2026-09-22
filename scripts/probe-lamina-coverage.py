#!/usr/bin/env python3
"""Probe which Itau retail funds have a lamina PDF on the public host.

Reads src/corretoras/itau-rentabilidade.json (phase-1 output) and issues one GET
per fund against the flat URL form, FOLLOWING redirects.

The content-type check is not optional: a fund with no lamina answers
200 text/html after two redirects, so status alone reports every fund as present.

Usage: python3 scripts/probe-lamina-coverage.py [--limit N] [--workers N]
"""
import argparse
import collections
import json
import os
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HOST = 'https://laminascomerciais-qh9.cloud.itau.com.br'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, 'src', 'corretoras', 'itau-rentabilidade.json')
MISSING = os.path.join(REPO, 'src', 'corretoras', 'itau-lamina-missing.json')


def lamina_url(fund_id):
    return f'{HOST}/{fund_id}_agencia.pdf'


def probe(fund):
    fid = fund['codigoProduto']
    req = urllib.request.Request(lamina_url(fid))
    req.add_header('User-Agent', 'Mozilla/5.0')
    status, ctype, modified, length = 0, '', '', 0
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            status = r.status
            ctype = r.headers.get('Content-Type', '')
            modified = r.headers.get('Last-Modified', '')
            length = int(r.headers.get('Content-Length') or 0)
    except urllib.error.HTTPError as e:
        status, ctype = e.code, e.headers.get('Content-Type', '')
    except Exception as e:
        status, ctype = 0, type(e).__name__
    return {
        'codigoProduto': fid,
        'nomeComercial': fund['nomeComercial'],
        'dataCriacaoProduto': fund.get('dataCriacaoProduto'),
        'status': status,
        'contentType': ctype.split(';')[0],
        'bytes': length,
        'lastModified': modified,
        'hasLamina': status == 200 and 'application/pdf' in ctype,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int)
    ap.add_argument('--workers', type=int, default=4)
    args = ap.parse_args()

    funds = json.load(open(DATA, encoding='utf8'))
    if args.limit:
        funds = funds[:args.limit]

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        rows = list(pool.map(probe, funds))

    hits = [r for r in rows if r['hasLamina']]
    miss = [r for r in rows if not r['hasLamina']]
    print(f'probed {len(rows)}   with lamina: {len(hits)}   without: {len(miss)}')
    print(f'coverage: {len(hits) / len(rows) * 100:.1f}%')
    print('status x content-type of the misses:',
          dict(collections.Counter(f"{r['status']} {r['contentType']}" for r in miss)))

    if miss:
        print('\nfunds with no lamina:')
        for r in sorted(miss, key=lambda r: r['codigoProduto']):
            print(f"  {r['codigoProduto']}  {(r['dataCriacaoProduto'] or ''):>10}  "
                  f"{r['nomeComercial'][:56]}")

    json.dump(sorted(miss, key=lambda r: r['codigoProduto']),
              open(MISSING, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    print(f'\nwrote {MISSING}')


if __name__ == '__main__':
    main()
