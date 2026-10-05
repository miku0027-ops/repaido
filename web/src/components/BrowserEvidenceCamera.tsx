import {useEffect,useRef,useState} from 'react';
import {Modal} from './ui';
import {currentPosition,operation,type Job} from '../services/operations';
import {embedCameraMetadata} from '../services/cameraMetadata.mjs';
export function BrowserEvidenceCamera({job,kind,onClose,onPhoto}:{job:Job;kind:'before'|'after';onClose:()=>void;onPhoto:(photo:{session:{id:string};jpeg:Uint8Array;metadata:Record<string,unknown>})=>void}){
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let cancelled=false;setReady(false);setError('');
  if(!navigator.mediaDevices?.getUserMedia){setError('Camera access needs a supported browser and HTTPS. Use the Android app if this browser has no camera.');return;}
  void navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false}).then(async s=>{if(cancelled){s.getTracks().forEach(t=>t.stop());return;}stream.current=s;if(video.current){video.current.srcObject=s;await video.current.play();setReady(true);}}).catch(()=>setError('Camera could not open. Allow camera access in browser settings, close other camera apps, then retry.'));
  return()=>{cancelled=true;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;};
 },[attempt]);
 const capture=async()=>{setBusy(true);setError('');try{
  const p=await currentPosition();
  const session=await operation<{id:string;job_id:string;visit_id:string;task_name:string;customer_name:string}>(`/jobs/${job.id}/capture-session`,{method:'POST',body:JSON.stringify({kind})});
  const v=video.current;if(!v?.videoWidth)throw Error('Camera is not ready. Retry.');
  const canvas=document.createElement('canvas');canvas.width=Math.min(v.videoWidth,1280);const height=Math.round(v.videoHeight*canvas.width/v.videoWidth);canvas.height=height+180;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Camera capture is not supported.');ctx.drawImage(v,0,0,canvas.width,height);ctx.fillStyle='#0B132B';ctx.fillRect(0,height,canvas.width,180);ctx.fillStyle='#fff';ctx.font='16px sans-serif';
  const metadata={...p,source:'repaido_web_camera_v1',captured_at:Date.now()/1000};
  const lines=[`REPAIDO · ${kind} · ${new Date().toISOString()}`,session.task_name,`Task: ${session.job_id}`,`Visit: ${session.visit_id}`,`Customer: ${session.customer_name}`,`GPS ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} ±${Math.round(p.accuracy)}m`,`Capture: ${session.id}`];
  lines.forEach((line,i)=>ctx.fillText(line,12,height+23+i*22,canvas.width-24));
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Photo capture failed.')),'image/jpeg',.85));
  const jpeg=embedCameraMetadata(new Uint8Array(await blob.arrayBuffer()),{...metadata,capture_id:session.id,job_id:session.job_id,visit_id:session.visit_id,task_name:session.task_name,customer_name:session.customer_name});
  stream.current?.getTracks().forEach(t=>t.stop());onPhoto({session,jpeg,metadata});
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <Modal title={`Capture ${kind} work photo`} onClose={onClose}><p>Show the work area only. Time, location and task details will be added to this private photo.</p><video ref={video} autoPlay playsInline muted aria-label="Live work camera preview" style={{width:'100%',maxHeight:'45vh',background:'#0B132B'}}/>{error&&<p role="alert">{error}</p>}<button type="button" className="ops-primary" disabled={!ready||busy} onClick={()=>void capture()}>{busy?'Capturing location and photo…':'Take photo and upload'}</button>{!ready&&<button type="button" onClick={()=>setAttempt(n=>n+1)}>Retry camera</button>}</Modal>;
}
