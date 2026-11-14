/** Snapshot the original GitHub Pages edition from the same source commit as the offline PWA. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir=process.cwd(),output=path.join(dir,'dist-online');
await fs.mkdir(output,{recursive:true});
for(const name of ['index.html','kg-chart-admin.html','kg-chart-review.html',
  'manifest.webmanifest','offline.html','sw.js']) await fs.copyFile(path.join(dir,name),path.join(output,name));
for(const folder of ['js','icons']) await fs.cp(path.join(dir,folder),path.join(output,folder),{recursive:true});
const revision=execFileSync('git',['rev-parse','--short=12','HEAD'],{cwd:dir,encoding:'utf8'}).trim();
await fs.writeFile(path.join(output,'online-build.json'),JSON.stringify({appVersion:revision,source:'index.html',unchanged:true}));
console.log('Built original KG Chart Online',revision,'without modifying the Pages source.');
