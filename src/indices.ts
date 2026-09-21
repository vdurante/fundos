require('dotenv').config();

import * as fundo from './fundos/fundos';

(async () => {
  try {
    await fundo.runBenchmarks();
    console.log('DONE');
  } catch (ex) {
    console.error(ex);
    process.exitCode = 1;
  }
})();
