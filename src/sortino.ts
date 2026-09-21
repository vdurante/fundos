import {runSortino} from './fundos/sortino';

const dryRun = process.argv.includes('--dry-run');

runSortino(dryRun)
  .then(({summary}) => {
    console.log(JSON.stringify(summary, null, 2));
    console.log(dryRun ? 'DRY RUN — nothing written' : 'DONE');
  })
  .catch(error => {
    console.error(error.message);
    process.exit(1);
  });
