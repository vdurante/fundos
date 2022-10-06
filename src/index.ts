require('dotenv').config();
//const yenv = require('yenv');
//yenv();

import * as fundo from './fundos/fundos';
import * as corretoras from './corretoras/corretoras';

(async () => {
  try {
    await corretoras.run();
    await fundo.run();
    console.log('DONE');
  } catch (ex) {
    console.error(ex);
    // eslint-disable-next-line no-debugger
    debugger;
  }
})();
