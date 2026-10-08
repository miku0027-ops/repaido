import {beginLoading} from './loading';
import {withActionFeedback} from './actionFeedback';
// Production default points to the live Cloud Run API backend; dev uses Vite proxy.
const defaultProdOrigin = 'https://repaido-api-rivzaqvyvq-uc.a.run.app';
const configuredOrigin = (
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? '' : defaultProdOrigin)
).replace(/\/+$/, '');

if (configuredOrigin && (new URL(configuredOrigin).protocol !== 'https:' || new URL(configuredOrigin).origin !== configuredOrigin)) {
  throw new Error('VITE_API_BASE_URL must be an HTTPS origin without a path.');
}

export async function apiFetch(path: string, init?: RequestInit, options?: {background?:boolean;feedback?:boolean}): Promise<Response> {
  // Never forward authentication headers to an arbitrary URL supplied by a caller.
  if (!path.startsWith('/api/')) throw new Error('Expected a Repaido API path.');
  const background=options?.background??((init?.method||'GET').toUpperCase()==='GET');
  const done=background?()=>{}:beginLoading(path);
  try{
    const send=()=>fetch(`${configuredOrigin}${path}`, {...init,signal:init?.signal||AbortSignal.timeout(20000)});
    if(options?.feedback===false||options?.background&&options?.feedback!==true)return await send();
    let response:Response|undefined;
    try{await withActionFeedback(path,init||{},async()=>{
      response=await send();
      // GETs do not need a body copy or completion notice.
      if((init?.method||'GET').toUpperCase()==='GET')return {};
      const body=await response.clone().json().catch(()=>({}));
      if(!response.ok)throw new Error(body.detail?.message||(typeof body.detail==='string'?body.detail:null)||(Array.isArray(body.detail)?body.detail.map((d:{msg:string})=>d.msg).join('. '):null)||'This action could not be completed. Review your details and retry.');
      return body;
    });}catch(error){if(!response)throw error;}
    return response!;
  }finally{done();}
}

export function apiAssetUrl(path: string): string {
  return path.startsWith('/api/') ? `${configuredOrigin}${path}` : path;
}
