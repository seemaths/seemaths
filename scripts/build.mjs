import { cp, mkdir, mkdtemp, rename, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildQuodes } from './build-quodes.mjs';

const source = new URL('../public/', import.meta.url);
const output = new URL('../dist/', import.meta.url);
const staging=await mkdtemp(path.join(tmpdir(),'seemaths-static-build-'));
try {
  await cp(source, staging, { recursive: true });
  const portal = new URL('../assignments-portal/static/', import.meta.url);
  await cp(portal, path.join(staging,'assets'), {recursive:true});
  for (const name of ['assignment-dashboard','assignments']) {
    await mkdir(path.join(staging,name),{recursive:true});
    await cp(new URL('index.html',portal),path.join(staging,name,'index.html'));
  }
  if (!process.argv.includes('--site-only')) {
    // Keep one server-side predecessor so a page opened immediately before a
    // deployment can lazily request its exact hashes. This copies no data into
    // browsers and does not accumulate an unbounded archive of releases.
    const predecessor=process.env.SEEMATHS_PREVIOUS_RELEASE_DIR ? pathToFileURL(path.resolve(process.env.SEEMATHS_PREVIOUS_RELEASE_DIR)+path.sep) : output;
    const previous = await readFile(new URL('browser-registry.json',predecessor),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(previous && /^[a-f0-9]{16}$/.test(previous.release)) {
      const archive=path.join(staging,'_offline');await mkdir(archive,{recursive:true});
      const hashes=new Set(Object.entries(previous.assets).filter(([url])=>!/(?:^|\/)(?:variations?(?:[./-]|$)|variation-(?:showcase|screenshots)(?:[./-]|$)|screenshots?(?:[./-]|$))|\.(?:md|map|csv)$|\/(?:psat-icon|app-icon)-original\.(?:png|svg|webp)$/i.test(url)).map(([,asset])=>asset.hash));
      for(const hash of hashes) {
        if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid prior asset hash');
        await cp(new URL('_offline/'+hash,predecessor),path.join(archive,hash)).catch(error=>{if(error.code!=='ENOENT')throw error;});
      }
      await cp(new URL('browser-registry.json',predecessor),path.join(archive,previous.release+'.json'));
    }
    await buildQuodes(staging);
  }
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
} finally {await rm(staging,{recursive:true,force:true});}
console.log(`Built SeeMaths website: ${fileURLToPath(output)}`);
