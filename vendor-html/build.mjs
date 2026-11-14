import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const result=await build({entryPoints:[path.join(here,'entry.js')],bundle:true,write:false,format:'iife',globalName:'V2RHtml',minify:false,target:['chrome120','firefox140'],legalComments:'inline',
  banner:{js:'/* parse5 7.3.0 + entities 6.0.1 (MIT). See HTML-PARSER-LICENSE.txt. Rebuild: vendor-html/README.md */'},
  footer:{js:'if (typeof module === "object" && module.exports) module.exports = V2RHtml;'}});
const licenses=await Promise.all(['parse5','entities'].map(async name=>name+'\n'+await readFile(path.join(here,'node_modules',name,'LICENSE'),'utf8')));
for(const browser of ['chrome','firefox']){
  const dest=path.join(here,'..',browser+'-extension','v2route-ui','vendor');await mkdir(dest,{recursive:true});
  await writeFile(path.join(dest,'html-parser.js'),result.outputFiles[0].contents);
  await writeFile(path.join(dest,'HTML-PARSER-LICENSE.txt'),licenses.join('\n\n'));
}
console.log(JSON.stringify({bytes:result.outputFiles[0].contents.length,browsers:2,minified:false}));
