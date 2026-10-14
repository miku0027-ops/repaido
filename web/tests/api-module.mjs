import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {feedbackImports} from './feedback-module.mjs';

const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const moduleUrl=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const loadingUrl=moduleUrl(compile(await readFile(new URL('../src/services/loading.ts',import.meta.url),'utf8')));
const apiSource=await readFile(new URL('../src/services/api.ts',import.meta.url),'utf8');

// Exercise the actual shared origin resolver. Only build-time settings and the
// browser origin differ between the development, Firebase and cPanel cases.
export function apiImports(code,{apiOrigin='',workOrigin='',development=true,pageOrigin='https://repaido.test'}={}){
  const source=apiSource.replace("'./loading'",JSON.stringify(loadingUrl))
    .replaceAll('import.meta.env.VITE_API_BASE_URL',JSON.stringify(apiOrigin))
    .replaceAll('import.meta.env.VITE_WORK_API_BASE_URL',JSON.stringify(workOrigin))
    .replaceAll('import.meta.env.DEV',String(development));
  const apiUrl=moduleUrl('const location={origin:'+JSON.stringify(pageOrigin)+'};\n'+compile(feedbackImports(source)));
  return code.replace(/from ['"]\.\/api['"]/g,'from '+JSON.stringify(apiUrl));
}
