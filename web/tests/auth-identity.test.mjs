import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// Exercise the real exported auth functions with an SDK/transport fixture.
// Extracting declarations avoids initializing unrelated catalogue services.
const serviceSource=await readFile(new URL('../src/services/repaidoService.ts',import.meta.url),'utf8');
const accountSource=await readFile(new URL('../src/services/accountProfileService.ts',import.meta.url),'utf8');
const appSource=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
const parse=(source,name='fixture.ts')=>ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true);
const transpile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll('export ','');
const serviceAst=parse(serviceSource),accountAst=parse(accountSource);
const names=['assertAuthIdentity','signInWithGoogle','confirmPhoneOtp','continueWithPhoneAccount'];
const declarations=names.map(name=>{
  const node=serviceAst.statements.find(item=>ts.isFunctionDeclaration(item)&&item.name?.text===name);
  assert.ok(node,'Real auth function exists: '+name);return node.getText(serviceAst);
});
const errorClass=accountAst.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='AccountProfileError');
assert.ok(errorClass);
const compiled=transpile(errorClass.getText(accountAst)+'\n'+declarations.join('\n'));
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const tick=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};

function fixture(){
  const auth={currentUser:{uid:'account-a'}},writes=[],tokenCalls=[],sessions=[],profileWrites=[];
  const control={token:async()=> 'fresh-account-a-token',session:async()=> {}};
  const user={uid:'account-a',displayName:'Account A',email:'actual@example.com',phoneNumber:'+919876543210',
    getIdToken:force=>{tokenCalls.push(force);return control.token(force);}};
  const dependencies={auth,GoogleAuthProvider:class {setCustomParameters(){}},
    signInWithPopup:async()=>({user}),confirmationResultRef:{confirm:async()=>({user})},
    phoneAccountRecovery:{continue:async()=>({user})},
    updateProfile:async(...args)=>{profileWrites.push(args);},canContinueWithPhoneAccount:()=>false,
    KEYS:{USER:'user',TOKEN:'token'},writeLocal:(key,value)=>writes.push({key,value}),
    establishAccountSession:async(...args)=>{sessions.push(args);return control.session(...args);}};
  const methods=new Function('dependencies',
    'const {auth,GoogleAuthProvider,signInWithPopup,confirmationResultRef,phoneAccountRecovery,updateProfile,canContinueWithPhoneAccount,KEYS,writeLocal,establishAccountSession}=dependencies;\n'+
    compiled+'\nreturn {AccountProfileError,signInWithGoogle,confirmPhoneOtp,continueWithPhoneAccount};')(dependencies);
  return {auth,writes,tokenCalls,sessions,profileWrites,control,...methods};
}

const flows={
  google:state=>state.signInWithGoogle('register'),
  phone:state=>state.confirmPhoneOtp('123456','Account A','actual@example.com'),
  recovery:state=>state.continueWithPhoneAccount()
};
const accountChanged=error=>error.code==='ACCOUNT_CHANGED'&&error.status===409;

for(const [name,run] of Object.entries(flows)){
  test(name+' rejects an account switch during token resolution before writing cached identity',async()=>{
    const state=fixture(),token=deferred();state.control.token=()=>token.promise;
    const pending=run(state);await tick();assert.equal(state.tokenCalls.length,1);
    state.auth.currentUser={uid:'account-b'};token.resolve('previous-account-token');
    await assert.rejects(pending,accountChanged);
    assert.deepEqual(state.writes,[]);assert.deepEqual(state.sessions,[]);
  });
  test(name+' rejects an account switch during session establishment instead of returning previous-account success',async()=>{
    const state=fixture(),session=deferred();state.control.session=()=>session.promise;
    const pending=run(state);await tick();assert.equal(state.sessions.length,1);
    const writesBeforeSwitch=state.writes.length;state.auth.currentUser={uid:'account-b'};session.resolve();
    await assert.rejects(pending,accountChanged);assert.equal(state.writes.length,writesBeforeSwitch);
  });
  test(name+' propagates an explicit ACCOUNT_CHANGED transport denial even when the SDK still shows the same UID',async()=>{
    const state=fixture();state.control.session=async()=>{throw new state.AccountProfileError('Account changed.',409,'ACCOUNT_CHANGED');};
    await assert.rejects(run(state),accountChanged);
  });
}

for(const name of ['google','phone']){
  test(name+' keeps a genuine same-account sign-in usable when optional profile setup is unavailable',async()=>{
    const state=fixture();state.control.session=async()=>{throw new state.AccountProfileError('Profile setup is temporarily unavailable.',503,'PROFILE_UNAVAILABLE');};
    const result=await flows[name](state);
    assert.equal(result.user.id,'account-a');assert.equal(result.token,'fresh-account-a-token');
    assert.equal(result.profileError,'Profile setup is temporarily unavailable.');
    assert.equal(state.writes.find(entry=>entry.key==='token').value,result.token);
    assert.equal(state.sessions[0][1],'register');
    if(name==='phone')assert.equal(state.sessions[0][2],'actual@example.com');
  });
}

test('phone recovery caches the freshly refreshed bearer and establishes only the recovered account session',async()=>{
  const state=fixture();await state.continueWithPhoneAccount();
  assert.deepEqual(state.tokenCalls,[true]);assert.deepEqual(state.sessions,[['account-a']]);
  assert.equal(state.writes.find(entry=>entry.key==='user').value.id,'account-a');
  assert.equal(state.writes.find(entry=>entry.key==='token').value,'fresh-account-a-token');
});

function actualAppCallback(functionName){
  const ast=parse(appSource,'App.tsx');let callback;
  const visit=node=>{
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text===functionName){
      let parent=node.parent;while(parent&&!ts.isArrowFunction(parent))parent=parent.parent;
      if(parent)callback=parent;
    }
    ts.forEachChild(node,visit);
  };
  visit(ast);assert.ok(callback,'Actual App callback calls '+functionName);
  return transpile('const callback='+callback.getText(ast)+';');
}
for(const functionName of ['signInWithGoogle','confirmPhoneOtp']){
  test('App '+functionName+' callback independently refuses a stale returned account before updating UI identity',async()=>{
    const changes=[],auth={currentUser:{uid:'account-b'}},errors=[];
    const old=async()=>({token:'old-token',user:{id:'account-a',name:'Account A'}});
    const noop=()=>{};
    const deps={auth,signInWithGoogle:old,confirmPhoneOtp:old,authMode:'create',otpCode:'123456',otpUserName:'Account A',otpEmail:'actual@example.com',
      setBusy:noop,setError:error=>errors.push(error),setToken:value=>changes.push(['token',value]),setUser:value=>changes.push(['user',value]),
      setSheet:noop,setOtpCode:noop,setOtpStep:noop,setOtpEmail:noop,setOtpUserName:noop,setEmailProfileOpen:noop,accountProfile:{refresh:async()=>{}}};
    const keys=Object.keys(deps);
    const callback=new Function('deps','const {'+keys.join(',')+'}=deps;'+actualAppCallback(functionName)+'return callback;')(deps);
    await callback({preventDefault:noop});
    assert.deepEqual(changes,[]);assert.match(errors.at(-1),/account changed/i);
  });
}

function supportFixture(){
  const member={uid:'account-a',getIdToken:async()=> 'verified-account-a-token'};
  const auth={currentUser:member,authStateReady:async()=>{}},requests=[];
  const control={send:async()=>new Response(JSON.stringify({ticket_id:'REP-TICKET-confirmed'}),{status:201})};
  const support=serviceAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='submitSupportTicket');
  assert.ok(support);
  const source=transpile(support.getText(serviceAst));
  const deps={auth,supportRequestIds:new Map(),crypto:{randomUUID:()=> 'stable-request-id'},
    assertAuthIdentity:uid=>{if(auth.currentUser?.uid!==uid)throw Error('Account changed');},
    apiFetch:async(...args)=>{requests.push(args);return control.send(...args);}};
  const submit=new Function('deps','const {'+Object.keys(deps).join(',')+'}=deps;'+source+'return submitSupportTicket;')(deps);
  return {auth,requests,control,member,submit};
}
const supportDetails={name:'Member A',phone:'9876543210',subject:'Booking question',message:'Please review this booking.'};

test('legacy support helper uses the canonical signed API and returns only a confirmed ticket',async()=>{
  const state=supportFixture();
  assert.equal(await state.submit({...supportDetails,user_id:'forged'}),'REP-TICKET-confirmed');
  const [path,init]=state.requests[0];
  assert.equal(path,'/api/support-tickets');assert.equal(init.headers.Authorization,'Bearer verified-account-a-token');
  assert.deepEqual(JSON.parse(init.body),{...supportDetails,request_id:'stable-request-id'});
});
test('support retries retain the command identity and never fabricate a ticket after server failure',async()=>{
  const state=supportFixture();let calls=0;
  state.control.send=async()=>new Response(JSON.stringify(++calls===1?{detail:{message:'Unavailable'}}:{ticket_id:'REP-TICKET-confirmed'}),{status:calls===1?503:201});
  await assert.rejects(state.submit(supportDetails),/Unavailable/);
  assert.equal(await state.submit(supportDetails),'REP-TICKET-confirmed');
  assert.equal(JSON.parse(state.requests[0][1].body).request_id,JSON.parse(state.requests[1][1].body).request_id);
});
test('support helper rejects guests and account switches during token resolution',async()=>{
  const guest=supportFixture();guest.auth.currentUser=null;
  await assert.rejects(guest.submit(supportDetails),/Sign in/);assert.equal(guest.requests.length,0);
  const state=supportFixture(),pendingToken=deferred();state.member.getIdToken=()=>pendingToken.promise;
  const pending=state.submit(supportDetails);await tick();state.auth.currentUser={uid:'account-b'};pendingToken.resolve('old-token');
  await assert.rejects(pending,/Account changed/);assert.equal(state.requests.length,0);
});
test('support helper rejects a late response after switching accounts',async()=>{
  const state=supportFixture(),pendingResponse=deferred();state.control.send=()=>pendingResponse.promise;
  const pending=state.submit(supportDetails);await tick();assert.equal(state.requests.length,1);
  state.auth.currentUser={uid:'account-b'};pendingResponse.resolve(new Response(JSON.stringify({ticket_id:'REP-TICKET-old-account'}),{status:201}));
  await assert.rejects(pending,/Account changed/);
});
