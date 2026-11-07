import { readSession,sameOrigin } from '../../src/operator-session.js';
import { isAdmin } from '../../src/auth.js';
export async function onRequest(context){
  const {request,env}=context;const path=new URL(request.url).pathname;
  if(['/api/session','/api/health','/api/ready','/api/weather','/api/recovery'].includes(path))return context.next();
  if(request.method==='POST'&&['/api/ingest','/api/events','/api/beacon/ingest'].includes(path)&&request.headers.has('X-Device-Key'))return context.next();
  if(isAdmin(request,env))return context.next();
  const session=await readSession(request,env);
  if(!session)return Response.json({error:'Sign in to view this data.'},{status:401,headers:{'Cache-Control':'no-store'}});
  if(!['GET','HEAD'].includes(request.method)&&!sameOrigin(request))return Response.json({error:'Request origin is not allowed.'},{status:403});
  context.data.operator=session;
  const headers=new Headers(request.headers);headers.set('Authorization','Bearer '+env.API_ADMIN_KEY);
  return context.next(new Request(request,{headers}));
}
