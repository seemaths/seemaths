import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  if (!process.argv.includes('--site-only')) await buildQuodes(staging);
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
} finally {await rm(staging,{recursive:true,force:true});}
console.log(`Built SeeMaths website: ${fileURLToPath(output)}`);
