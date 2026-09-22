const {loadRegistry}=require('./scripts/lib/cvm-registry.js');
(async()=>{
  const reg=await loadRegistry({});
  for(const c of ['36.015.100/0001-39','26.587.503/0001-07']){
    const e=reg.lookup(c);
    console.log(`${c}  ${e?`${e.isClass?'class':'fund '} | ${e.situacao} | ${e.name}`:'NOT REGISTERED'}`);
  }
})();
