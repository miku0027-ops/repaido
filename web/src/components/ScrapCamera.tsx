import {useEffect,useRef,useState} from 'react';
import {Camera,Check,RotateCcw,ShieldCheck} from 'lucide-react';
import {auth} from '../firebase';
import {currentPosition,operation} from '../services/operations';
import {business,businessPrivatePhoto,type BusinessLocation} from '../services/localBusiness';
import {embedCameraMetadata} from '../services/cameraMetadata.mjs';
import {Modal} from './ui';

export type ScrapPhoto={id:string;server_received_at:number;preview?:string};
const account=()=>auth.currentUser?.uid||localStorage.getItem('repaido.token')||'guest';
export function ScrapCamera({requestId,pickup,onClose,onSaved}:{requestId:string;pickup:BusinessLocation;onClose:()=>void;onSaved:(photo:ScrapPhoto)=>void}){
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null),alive=useRef(true),scope=useRef(account()),pending=useRef<{id:string;jpeg:Blob;metadata:object}|null>(null),gate=useRef(false);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const assertAccount=()=>{if(!alive.current||scope.current!==account())throw Error('Your account changed. Reopen the camera.');};
 useEffect(()=>{alive.current=true;let cancelled=false;setReady(false);setError('');
  const stop=()=>{stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;};
  if(!navigator.mediaDevices?.getUserMedia){setError('Camera access needs HTTPS and a supported browser. Open Repaido in your phone’s browser.');return;}
  void navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false}).then(async media=>{if(cancelled){media.getTracks().forEach(track=>track.stop());return;}stream.current=media;if(video.current){video.current.srcObject=media;await video.current.play();if(!cancelled)setReady(true);}}).catch(()=>{if(!cancelled)setError('Allow camera access in browser settings, then retry.');});
  const hidden=()=>{if(document.hidden){stop();setReady(false);}};
  document.addEventListener('visibilitychange',hidden);
  return()=>{cancelled=true;alive.current=false;stop();document.removeEventListener('visibilitychange',hidden);};
 },[attempt]);
 const capture=async()=>{if(gate.current)return;gate.current=true;setBusy(true);setError('');try{
  if(!pending.current){
   setStatus('Checking pickup location…');const position=await currentPosition(true);assertAccount();
   const session=await business<{id:string}>('/scrap/capture-sessions',{request_id:requestId,location:{lat:pickup.lat,lng:pickup.lng}},'POST',{feedback:false});assertAccount();
   const camera=video.current;if(!camera?.videoWidth)throw Error('The camera is not ready. Retry camera access.');
   const canvas=document.createElement('canvas');canvas.width=Math.min(1280,camera.videoWidth);canvas.height=Math.round(camera.videoHeight*canvas.width/camera.videoWidth);
   const context=canvas.getContext('2d');if(!context)throw Error('Photo capture is unavailable in this browser.');context.drawImage(camera,0,0,canvas.width,canvas.height);
   const raw=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('The photo could not be captured. Retake it.')),'image/jpeg',.88));assertAccount();
   const metadata={...position,captured_at:Date.now()/1000,source:'repaido_web_camera_v1'};
   const jpeg=embedCameraMetadata(new Uint8Array(await raw.arrayBuffer()),{...metadata,capture_id:session.id,request_id:requestId});
   pending.current={id:session.id,jpeg:new Blob([jpeg],{type:'image/jpeg'}),metadata};
  }
  assertAccount();setStatus('Uploading your pickup photo…');
  const captured=pending.current;
  const saved=await operation<ScrapPhoto>(`/local-business/scrap/capture-sessions/${captured.id}/photo`,{method:'POST',headers:{'Content-Type':'image/jpeg','X-Capture-Metadata':JSON.stringify(captured.metadata)},body:captured.jpeg},{background:true,feedback:false});assertAccount();
  let preview:string|undefined;try{preview=await businessPrivatePhoto('/documents/'+saved.id);}catch{/* The confirmed receipt remains valid if preview loading fails. */}
  if(!alive.current||scope.current!==account()){if(preview)URL.revokeObjectURL(preview);return;}
  onSaved({...saved,preview});
 }catch(problem){if(alive.current){setError((problem as Error).message);setStatus(pending.current?'Photo captured. Upload is not confirmed.':'');}}finally{gate.current=false;if(alive.current)setBusy(false);}};
 return <Modal title="Repaido pickup camera" className="scrap-camera-dialog" onClose={onClose}><div className="scrap-camera-brand"><ShieldCheck size={20}/><span>Private pickup evidence</span></div><div className="scrap-camera-preview"><video ref={video} autoPlay muted playsInline aria-label="Live scrap camera preview"/><span><Camera size={16}/>REPAIDO · SCRAP</span></div><p>Show the scrap only. Repaido adds the receipt time and a camera reference. Your photo is shared with the assigned collector.</p>{error&&<p className="ops-error" role="alert">{error}</p>}{status&&<p role="status">{status}</p>}<button type="button" className="ops-primary" disabled={busy||(!ready&&!pending.current)} aria-busy={busy} onClick={()=>void capture()}>{busy?status:pending.current?'Retry photo upload':<><Camera size={18}/>Take pickup photo</>}</button>{!busy&&<button type="button" onClick={()=>{pending.current=null;setStatus('');setAttempt(value=>value+1);}}><RotateCcw size={16}/>{ready?'Retake photo':'Retry camera'}</button>}<small className="scrap-camera-location"><Check size={14}/>Pickup location and a fresh camera receipt are required.</small></Modal>;
}
