require('dotenv').config();

import {runRentabilidades} from './fundos/fundos';

const dryRun = process.argv.includes('--dry-run');

runRentabilidades(dryRun)
  .then(summary => {
    console.log(JSON.stringify(summary, null, 2));
    console.log(dryRun ? 'DRY RUN — nothing written' : 'DONE');
  })
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
