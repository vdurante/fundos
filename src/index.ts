require('dotenv').config();

import * as fundo from './fundos/fundos';

(async () => {
  try {
    await fundo.run();
  } catch (ex) {
    console.error(ex);
    // eslint-disable-next-line no-debugger
    debugger;
  }
})();
