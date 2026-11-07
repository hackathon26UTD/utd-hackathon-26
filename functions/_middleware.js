import { readSession } from '../src/operator-session.js';
export async function onRequest(context){
  const path=new URL(context.request.url).pathname.replace(/\.html$/,'').replace(/\/$/,'');
  if(path==='/portal')return Response.redirect(new URL(await readSession(context.request,context.env)?'/command-center':'/login',context.request.url),302);
  if(['/command-center','/profile'].includes(path)&&!await readSession(context.request,context.env))return Response.redirect(new URL('/login',context.request.url),302);
  return context.next();
}
