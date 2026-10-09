// Isolated test entry, excluded from production. Only a disposable API is used.
import {createRoot} from 'react-dom/client';
import {auth} from '../src/firebase';
import OperationsAdmin from '../src/components/OperationsAdmin';
import {AppExperience} from '../src/components/AppExperience';
import {actionFeedback} from '../src/services/actionFeedback';
import '../src/styles.css';
import '../src/design-system.css';
await auth.authStateReady();
const authListeners=new Set<(user:any)=>void>(),tokenListeners=new Set<(user:any)=>void>();
const fixture:any={feedback:[],forcedTokens:0,emit(uid='admin-a'){
 (auth as any).currentUser={uid,email:uid+'@example.test',getIdToken:async(force:boolean)=>{if(force)fixture.forcedTokens++;return uid;},getIdTokenResult:async()=>({claims:{admin:uid.startsWith('admin-')}})};
 localStorage.setItem('repaido.token',uid);for(const listener of [...authListeners,...tokenListeners])listener(auth.currentUser);
}};
(auth as any).onAuthStateChanged=(listener:(user:any)=>void)=>{authListeners.add(listener);queueMicrotask(()=>listener(auth.currentUser));return()=>authListeners.delete(listener);};
(auth as any).onIdTokenChanged=(listener:(user:any)=>void)=>{tokenListeners.add(listener);queueMicrotask(()=>listener(auth.currentUser));return()=>tokenListeners.delete(listener);};
fixture.emit();(window as any).__adminFixture=fixture;
actionFeedback.subscribe(()=>fixture.feedback.push(...actionFeedback.getSnapshot().map(item=>item.title)));
createRoot(document.getElementById('root')!).render(<><OperationsAdmin onBack={()=>{}}/><AppExperience/></>);
