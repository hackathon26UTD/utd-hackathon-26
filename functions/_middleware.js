import { readSession,readCustomerSession } from '../src/operator-session.js';
// Pages `_headers` covers static assets only. Keep the same policy on responses
// returned through Functions, including redirects and authenticated pages.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://tiles.openfreemap.org https://basemap.nationalmap.gov https://opengeo.ncep.noaa.gov; connect-src 'self' https://tiles.openfreemap.org https://basemap.nationalmap.gov https://opengeo.ncep.noaa.gov; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function secure(response, path) {
  const result = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) result.headers.set(name, value);
  if (path === '/demo') result.headers.set('Content-Security-Policy', SECURITY_HEADERS['Content-Security-Policy'].replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
  return result;
}

export async function onRequest(context){
  const path=new URL(context.request.url).pathname.replace(/\.html$/,'').replace(/\/$/,'');
  if(path==='/portal'){const target=await readSession(context.request,context.env)?'/command-center':await readCustomerSession(context.request,context.env)?'/customer':'/login';return secure(Response.redirect(new URL(target,context.request.url),302));}
  if(['/command-center','/profile'].includes(path)&&!await readSession(context.request,context.env))return secure(Response.redirect(new URL('/login',context.request.url),302));
  return secure(await context.next(), path);
}
