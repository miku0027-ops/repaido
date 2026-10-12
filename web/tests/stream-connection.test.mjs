import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {connectStream,streamEndpoint} from '../src/services/streamConnection.mjs';
let peers,calls,response;
beforeEach(()=>{peers=[];calls=[];response=()=>new Response('valid-test-sdp-answer',{status:201,headers:{Location:'/session/opaque'}});globalThis.RTCPeerConnection=class{constructor(){this.iceGatheringState='complete';this.connectionState='new';this.tracks=[];peers.push(this);}addTrack(track){this.tracks.push(track);}addTransceiver(kind,config){this.tracks.push({kind,...config});}async createOffer(){return {type:'offer',sdp:'valid-test-sdp-offer'};}async setLocalDescription(value){this.localDescription=value;}async setRemoteDescription(value){this.remoteDescription=value;}close(){this.closed=true;}};globalThis.fetch=async(url,init)=>{calls.push({url,init});return response(url,init);};});
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
