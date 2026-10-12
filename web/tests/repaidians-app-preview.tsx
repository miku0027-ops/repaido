// Test-only Firebase client adapter. The API still validates the real fixture
// session token; this entry is never part of the deployed application.
import {auth} from '../src/firebase';
const user=JSON.parse(localStorage.getItem('repaidians.test-user')||'null'),token=localStorage.getItem('repaido.token');
await auth.authStateReady();
if(user&&token)(auth as any).currentUser={uid:user.id,displayName:user.name,email:user.email,phoneNumber:'+919876543210',getIdToken:async()=>token,getIdTokenResult:async()=>({claims:{}})};
await import('../src/main');
