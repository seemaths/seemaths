// Pin the actual published predecessor, not the most recent local test build.
// Old open pages can then request their exact immutable files during an update.
import {readFile,writeFile,mkdir,copyFile,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
const origin='https://seemaths.org', snapshot=path.resolve('.wrangler/published-predecessor');
const response=await fetch(origin+'/browser-registry.json',{cache:'no-store',signal:AbortSignal.timeout(30000)});
let previous;
if(response.status!==404) {
  if(!response.ok)throw Error('Could not read the published registry: '+response.status);
  const source=await response.text();previous=JSON.parse(source);
  if(previous.schema!==1||!/^[a-f0-9]{16}$/.test(previous.release))throw Error('Invalid published registry');
  const wanted=new Map();
  for(const [url,asset] of Object.entries(previous.assets)) {
    if(/(?:^|\/)(?:variations?(?:[./-]|$)|variation-(?:showcase|screenshots)(?:[./-]|$)|screenshots?(?:[./-]|$))|\.(?:md|map|csv)$|\/(?:psat-icon|app-icon)-original\.(?:png|svg|webp)$/i.test(url))continue;
    if(!/^[a-f0-9]{64}$/.test(asset.hash)||!Number.isSafeInteger(asset.bytes)||asset.bytes<0||asset.bytes>25*1024*1024)throw Error('Invalid published asset');
    wanted.set(asset.hash,asset);
  }
  const archive=path.join(snapshot,'_offline');await mkdir(archive,{recursive:true});
  const pending=[...wanted.values()];let downloaded=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(pending.length) {
      const asset=pending.shift(),target=path.join(archive,asset.hash);
      const valid=body=>body.length===asset.bytes&&createHash('sha256').update(body).digest('hex')===asset.hash;
      const saved=await readFile(target).catch(()=>null);if(saved&&valid(saved))continue;
      const local=path.resolve('dist/_offline',asset.hash),body=await readFile(local).catch(()=>null);
      if(body&&valid(body)){await copyFile(local,target);continue;}
      const remote=await fetch(origin+'/_offline/'+asset.hash,{signal:AbortSignal.timeout(30000)});
      if(!remote.ok)throw Error('Could not retain predecessor asset: '+remote.status);
      const bytes=Buffer.from(await remote.arrayBuffer());if(!valid(bytes))throw Error('Predecessor asset integrity mismatch');
      await writeFile(target,bytes);downloaded++;
    }
  }));
  await writeFile(path.join(snapshot,'browser-registry.json'),source);
  for(const name of await readdir(archive))if(!wanted.has(name))await rm(path.join(archive,name),{force:true});
  console.log(`Retained published release ${previous.release}; ${downloaded} predecessor files fetched.`);
}
const child=spawn('npx',['wrangler','deploy',...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,...(previous?{SEEMATHS_PREVIOUS_RELEASE_DIR:snapshot}:{})}});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
