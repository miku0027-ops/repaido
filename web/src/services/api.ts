import {beginLoading} from './loading';
// Production default points to the live Cloud Run API backend; dev uses Vite proxy.
const defaultProdOrigin = 'https://repaido-api-rivzaqvyvq-uc.a.run.app';
const configuredOrigin = (
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? '' : defaultProdOrigin)
).replace(/\/+$/, '');

if (configuredOrigin && (new URL(configuredOrigin).protocol !== 'https:' || new URL(configuredOrigin).origin !== configuredOrigin)) {
  throw new Error('VITE_API_BASE_URL must be an HTTPS origin without a path.');
}

export async function apiFetch(path: string, init?: RequestInit, options?: {background?:boolean}): Promise<Response> {
  // Never forward authentication headers to an arbitrary URL supplied by a caller.
  if (!path.startsWith('/api/')) throw new Error('Expected a Repaido API path.');
  const background=options?.background??((init?.method||'GET').toUpperCase()==='GET');
  const done=background?()=>{}:beginLoading(path);
  try{return await fetch(`${configuredOrigin}${path}`, {...init,signal:init?.signal||AbortSignal.timeout(20000)});}finally{done();}
}

export function apiAssetUrl(path: string): string {
  return path.startsWith('/api/') ? `${configuredOrigin}${path}` : path;
}
