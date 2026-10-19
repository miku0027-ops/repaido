import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {connectStream,streamEndpoint} from '../src/services/streamConnection.mjs';
let peers,calls,response;
beforeEach(()=>{peers=[];calls=[];response=()=>new Response('valid-test-sdp-answer',{status:201,headers:{Location:'/session/opaque'}});globalThis.RTCPeerConnection=class extends EventTarget{constructor(){super();this.iceGatheringState='complete';this.connectionState='connected';this.tracks=[];peers.push(this);}addTrack(track){this.tracks.push(track);}addTransceiver(kind,config){this.tracks.push({kind,...config});}async createOffer(){return {type:'offer',sdp:'valid-test-sdp-offer'};}async setLocalDescription(value){this.localDescription=value;}async setRemoteDescription(value){this.remoteDescription=value;}close(){this.closed=true;}};globalThis.fetch=async(url,init)=>{calls.push({url,init});return response(url,init);};});
test('browser publishing and viewing use only the Cloudflare media endpoints',async()=>{
 const stream={getTracks:()=>[{kind:'video'}]},sender=await connectStream('https://customer-test.cloudflarestream.com/secret/webRTC/publish',{stream});assert.equal(calls[0].init.headers['Content-Type'],'application/sdp');assert.equal(peers[0].tracks[0].kind,'video');assert.equal(peers[0].remoteDescription.type,'answer');await sender.close();assert.equal(calls.at(-1).init.method,'DELETE');assert.equal(peers[0].closed,true);
 const viewer=await connectStream('https://customer-test.cloudflarestream.com/signed/webRTC/play');assert.deepEqual(peers[1].tracks,[{kind:'video',direction:'recvonly'},{kind:'audio',direction:'recvonly'}]);await viewer.close();
});
test('invalid origins and cross-origin session URLs cannot receive SDP or credentials',async()=>{
 assert.throws(()=>streamEndpoint('https://attacker.test/'),/invalid/);assert.throws(()=>streamEndpoint('http://customer-test.cloudflarestream.com/'),/invalid/);
 response=()=>new Response('sdp',{status:201,headers:{Location:'https://attacker.test/session'}});await assert.rejects(connectStream('https://customer-test.cloudflarestream.com/token/webRTC/play'),/invalid/);assert.equal(peers[0].closed,true);assert(calls.every(call=>!call.url.includes('attacker.test')));
});
test('connection failures close the peer and a cancelled connection never sends media',async()=>{
 response=()=>new Response('unavailable',{status:503});await assert.rejects(connectStream('https://customer-test.cloudflarestream.com/token/webRTC/play'),/could not/);assert.equal(peers[0].closed,true);
 calls=[];const controller=new AbortController();controller.abort();await assert.rejects(connectStream('https://customer-test.cloudflarestream.com/token/webRTC/play',{signal:controller.signal}),/cancelled/);assert.equal(calls.length,0);assert.equal(peers[1].closed,true);
});
test('separate audio and video events keep one playable stream',async()=>{
 globalThis.MediaStream=class{constructor(){this.tracks=[];}getTracks(){return this.tracks;}addTrack(track){this.tracks.push(track);}};
 const received=[],viewer=await connectStream('https://customer-test.cloudflarestream.com/signed/webRTC/play',{onTrack:stream=>received.push(stream)});
 peers[0].ontrack({track:{id:'video',kind:'video'},streams:[]});peers[0].ontrack({track:{id:'audio',kind:'audio'},streams:[]});
 assert.equal(received[0],received[1]);assert.deepEqual(received[1].getTracks().map(track=>track.kind),['video','audio']);await viewer.close();
});
test('an answered offer cannot be reported as connected when media transport failed',async()=>{
 const original=globalThis.RTCPeerConnection;
 globalThis.RTCPeerConnection=class extends original{async setRemoteDescription(value){await super.setRemoteDescription(value);this.connectionState='failed';}};
 await assert.rejects(connectStream('https://customer-test.cloudflarestream.com/secret/webRTC/publish'),/connection stopped/);
 assert.equal(peers[0].closed,true);assert.equal(calls.at(-1).init.method,'DELETE');
});

test('publishing waits for a connected media transport after the SDP answer',async()=>{
 const original=globalThis.RTCPeerConnection;
 globalThis.RTCPeerConnection=class extends original{async setRemoteDescription(value){await super.setRemoteDescription(value);this.connectionState='connecting';setTimeout(()=>{this.connectionState='connected';this.dispatchEvent(new Event('connectionstatechange'));},25);}};
 let settled=false;const session=connectStream('https://customer-test.cloudflarestream.com/secret/webRTC/publish').then(value=>{settled=true;return value;});
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(settled,false);const result=await session;assert.equal(result.peer.connectionState,'connected');await result.close();
});

test('a cancelled offer still releases a session learned from a late response',async()=>{
 const controller=new AbortController();
 response=(_url,init)=>{
  if(init.method==='POST')controller.abort();
  return new Response('valid-test-sdp-answer',{status:201,headers:{Location:'/session/late'}});
 };
 await assert.rejects(connectStream('https://customer-test.cloudflarestream.com/token/webRTC/publish',{signal:controller.signal}),/cancelled/);
 assert.equal(peers[0].closed,true);assert.equal(peers[0].remoteDescription,undefined);
 assert.deepEqual(calls.map(call=>call.init.method),['POST','DELETE']);
 assert.equal(calls[1].url,'https://customer-test.cloudflarestream.com/session/late');
 assert.equal(calls[1].init.signal.aborted,false,'Session cleanup has its own deadline after the caller cancels');
});

test('cancellation during offer creation exits before waiting for ICE gathering',async()=>{
 const controller=new AbortController(),original=globalThis.RTCPeerConnection;
 globalThis.RTCPeerConnection=class extends original{
  constructor(){super();this.iceGatheringState='gathering';}
  async setLocalDescription(value){await super.setLocalDescription(value);controller.abort();}
 };
 await assert.rejects(connectStream('https://customer-test.cloudflarestream.com/token/webRTC/play',{signal:controller.signal}),/cancelled/);
 assert.equal(peers[0].closed,true);assert.equal(calls.length,0);
});

test('closing a connected session is idempotent and silences late peer events',async()=>{
 const tracks=[],failures=[],session=await connectStream('https://customer-test.cloudflarestream.com/token/webRTC/play',{onTrack:stream=>tracks.push(stream),onFailure:message=>failures.push(message)});
 await Promise.all([session.close(),session.close()]);
 peers[0].connectionState='disconnected';peers[0].onconnectionstatechange();
 peers[0].ontrack({track:{id:'late',kind:'video'},streams:[]});
 assert.equal(calls.filter(call=>call.init.method==='DELETE').length,1);
 assert.deepEqual(failures,[]);assert.deepEqual(tracks,[]);
});
