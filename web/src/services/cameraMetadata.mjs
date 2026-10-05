// Embed UTF-8 JSON as EXIF UserComment; server validates this against the session.
export function embedCameraMetadata(jpeg, metadata) {
  if(jpeg[0]!==255||jpeg[1]!==216) throw Error('Camera did not produce a JPEG. Retake the photo.');
  const text=new TextEncoder().encode(JSON.stringify(metadata));
  const payload=new Uint8Array(6+26+text.length);
  payload.set([69,120,105,102,0,0,73,73,42,0,8,0,0,0]);
  const view=new DataView(payload.buffer);
  view.setUint16(14,1,true);view.setUint16(16,0x9286,true);view.setUint16(18,7,true);
  view.setUint32(20,text.length,true);view.setUint32(24,26,true);view.setUint32(28,0,true);payload.set(text,32);
  if(payload.length+2>65535) throw Error('Capture metadata is too large.');
  const out=new Uint8Array(jpeg.length+payload.length+4);
  out.set(jpeg.subarray(0,2));out.set([255,225,(payload.length+2)>>8,(payload.length+2)&255],2);out.set(payload,6);out.set(jpeg.subarray(2),6+payload.length);return out;
}
