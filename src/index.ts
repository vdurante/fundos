require('dotenv').config();
//const yenv = require('yenv');
//yenv();

import * as fundo from './fundos/fundos';

(async () => {
  try {
    await fundo.run();
    console.log('DONE');
  } catch (ex) {
    console.error(ex);
    // eslint-disable-next-line no-debugger
    debugger;
  }
})();
