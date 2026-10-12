export function streamEndpoint(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.cloudflarestream.com')||url.username||url.password||url.hash||url.port&&url.port!=='443')throw Error('Video returned an invalid connection.');
 return url.href;
}
export async function connectStream(url,{stream,onTrack,onFailure,signal}={}){
 const endpoint=streamEndpoint(url),peer=new RTCPeerConnection({bundlePolicy:'max-bundle'});let resource='',stopped=false,incoming;
 const close=async()=>{if(stopped)return;stopped=true;peer.close();if(resource)try{await fetch(resource,{method:'DELETE',signal:AbortSignal.timeout(5000)});}catch{}};
 const abort=()=>{void close();};signal?.addEventListener('abort',abort,{once:true});
 peer.ontrack=event=>{incoming??=new MediaStream();if(!incoming.getTracks().some(track=>track.id===event.track.id))incoming.addTrack(event.track);onTrack?.(incoming);};
 peer.onconnectionstatechange=()=>{if(['failed','disconnected'].includes(peer.connectionState))onFailure?.('Video connection stopped. Please retry.');};
 try{
  if(stream){for(const track of stream.getTracks())peer.addTrack(track,stream);}else{peer.addTransceiver('video',{direction:'recvonly'});peer.addTransceiver('audio',{direction:'recvonly'});}
  await peer.setLocalDescription(await peer.createOffer());
  if(peer.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(Error('Video connection took too long. Please retry.'));},10000);const changed=()=>{if(peer.iceGatheringState==='complete'){cleanup();resolve();}};const cancelled=()=>{cleanup();reject(Error('Video connection cancelled.'));};function cleanup(){clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',changed);signal?.removeEventListener('abort',cancelled);}peer.addEventListener('icegatheringstatechange',changed);signal?.addEventListener('abort',cancelled,{once:true});});
  if(stopped||signal?.aborted)throw Error('Video connection cancelled.');
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/sdp'},body:peer.localDescription.sdp,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Video could not connect. Please retry.');
  const location=response.headers.get('Location');if(location){const candidate=streamEndpoint(new URL(location,endpoint).href);if(new URL(candidate).origin!==new URL(endpoint).origin)throw Error('Video returned an invalid session.');resource=candidate;}
  await peer.setRemoteDescription({type:'answer',sdp:await response.text()});
  return {peer,close:async()=>{signal?.removeEventListener('abort',abort);await close();}};
 }catch(error){signal?.removeEventListener('abort',abort);await close();throw error;}
}
