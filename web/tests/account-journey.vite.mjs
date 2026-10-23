// Local-only test server: the Firebase Auth boundary is replaced, while the
// application components and HTTP services run unchanged against the test API.
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const server=await createServer({root,configFile:root+'vite.config.ts',
 resolve:{alias:[{find:/^firebase\/auth$/,replacement:root+'tests/account-journey-auth.fixture.ts'}]},
 server:{host:'127.0.0.1',port:5189,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:8198',changeOrigin:true,rewrite:path=>path.replace(/^\/api/,'')}}}});
await server.listen();
console.log('Account journey preview: http://127.0.0.1:5189/tests/account-journey-preview.html');
