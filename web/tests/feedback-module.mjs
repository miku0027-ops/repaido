import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/services/actionFeedback.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace("'./actionMessages.mjs'",JSON.stringify(new URL('../src/services/actionMessages.mjs',import.meta.url).href));
export const feedbackModuleUrl='data:text/javascript;base64,'+Buffer.from(code).toString('base64');
export const feedbackImports=code=>code.replace(/from ['"]\.\/actionFeedback['"]/g,'from '+JSON.stringify(feedbackModuleUrl)).replace(/from ['"]\.\/actionMessages\.mjs['"]/g,'from '+JSON.stringify(new URL('../src/services/actionMessages.mjs',import.meta.url).href));
