import * as cacache from 'cacache';
import axios from 'axios';
export function range(startInclusive: number, stopExclusive: number, step = 1) {
  if (typeof stopExclusive === 'undefined') {
    // one param defined
    stopExclusive = startInclusive;
    startInclusive = 0;
  }

  if (typeof step === 'undefined') {
    step = 1;
  }

  if (
    (step > 0 && startInclusive >= stopExclusive) ||
    (step < 0 && startInclusive <= stopExclusive)
  ) {
    return [];
  }

  const result = [];
  for (
    let i = startInclusive;
    step > 0 ? i < stopExclusive : i > stopExclusive;
    i += step
  ) {
    result.push(i);
  }

  return result;
}

export interface CsvType {
  [key: string]: string;
}

export async function getFile(url: string) {
  const file = await cacache.get.info('.cache', url);
  if (!file || !process.env.CACHE_FILE) {
    try {
      const result = await axios.get(url, {
        responseType: 'arraybuffer',
      });

      await cacache.put('.cache', url, result.data);
    } catch (ex) {
      if (ex.response.status === 404) {
        await cacache.put('.cache', url, '404');
        return undefined;
      }

      throw ex;
    }
  }
  const data = await (await cacache.get('.cache', url)).data;
  if (data.toString() === '404') {
    return undefined;
  }
  return data;
}
