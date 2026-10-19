export function streamEndpoint(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.cloudflarestream.com')||url.username||url.password||url.hash||url.port&&url.port!=='443')throw Error('Video returned an invalid connection.');
 return url.href;
}
async function connected(peer,signal){
 if(signal?.aborted)throw Error('Video connection cancelled.');
 if(peer.connectionState==='connected')return;
 if(['closed','failed','disconnected'].includes(peer.connectionState))throw Error('Video connection stopped. Please retry.');
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>finish(Error('Video has not connected. Please retry.')),20000);
  const change=()=>{if(peer.connectionState==='connected')finish();else if(['closed','failed','disconnected'].includes(peer.connectionState))finish(Error('Video connection stopped. Please retry.'));};
  const abort=()=>finish(Error('Video connection cancelled.'));
  function finish(error){clearTimeout(timer);peer.removeEventListener('connectionstatechange',change);signal?.removeEventListener('abort',abort);error?reject(error):resolve();}
  peer.addEventListener('connectionstatechange',change);signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();else change();
 });
}
export async function connectStream(url,{stream,onTrack,onFailure,signal}={}){
 const endpoint=streamEndpoint(url),peer=new RTCPeerConnection({bundlePolicy:'max-bundle'});let resource='',stopped=false,incoming,deletion;
 // Cancellation can close the peer while the offer response is still arriving.
 // A session URL learned afterwards must still be released exactly once.
 const close=async()=>{
  if(!stopped){stopped=true;peer.close();}
  if(resource&&!deletion)deletion=fetch(resource,{method:'DELETE',signal:AbortSignal.timeout(5000)}).catch(()=>{});
  await deletion;
 };
 const abort=()=>{void close();};signal?.addEventListener('abort',abort,{once:true});
 peer.ontrack=event=>{if(stopped)return;incoming??=new MediaStream();if(!incoming.getTracks().some(track=>track.id===event.track.id))incoming.addTrack(event.track);onTrack?.(incoming);};
 peer.onconnectionstatechange=()=>{if(!stopped&&['failed','disconnected'].includes(peer.connectionState))onFailure?.('Video connection stopped. Please retry.');};
 try{
  if(signal?.aborted)throw Error('Video connection cancelled.');
  if(stream){for(const track of stream.getTracks())peer.addTrack(track,stream);}else{peer.addTransceiver('video',{direction:'recvonly'});peer.addTransceiver('audio',{direction:'recvonly'});}
  await peer.setLocalDescription(await peer.createOffer());
  if(stopped||signal?.aborted)throw Error('Video connection cancelled.');
  if(peer.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(Error('Video connection took too long. Please retry.'));},10000);const changed=()=>{if(peer.iceGatheringState==='complete'){cleanup();resolve();}};const cancelled=()=>{cleanup();reject(Error('Video connection cancelled.'));};function cleanup(){clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',changed);signal?.removeEventListener('abort',cancelled);}peer.addEventListener('icegatheringstatechange',changed);signal?.addEventListener('abort',cancelled,{once:true});if(signal?.aborted)cancelled();else changed();});
  if(stopped||signal?.aborted)throw Error('Video connection cancelled.');
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/sdp'},body:peer.localDescription.sdp,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Video could not connect. Please retry.');
  const location=response.headers.get('Location');if(location){const candidate=streamEndpoint(new URL(location,endpoint).href);if(new URL(candidate).origin!==new URL(endpoint).origin)throw Error('Video returned an invalid session.');resource=candidate;}
  if(stopped||signal?.aborted)throw Error('Video connection cancelled.');
  const answer=await response.text();
  if(stopped||signal?.aborted)throw Error('Video connection cancelled.');
  await peer.setRemoteDescription({type:'answer',sdp:answer});
  await connected(peer,signal);
  if(stopped||signal?.aborted)throw Error('Video connection cancelled.');
  return {peer,close:async()=>{signal?.removeEventListener('abort',abort);await close();}};
 }catch(error){signal?.removeEventListener('abort',abort);await close();throw error;}
}
