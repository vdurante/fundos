import * as fundo from './fundos';

(async () => {
  try {
    await fundo.run();
  } catch (ex) {
    console.error(ex);
  }
})();
