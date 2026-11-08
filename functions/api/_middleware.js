import { readSession,sameOrigin } from '../../src/operator-session.js';
import { isAdmin } from '../../src/auth.js';
const json=(body,status,extra={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...extra}});
// Device-key requests pass through: the handler checks the key itself. Anything with a device key is never treated as an operator.
const DEVICE_POST=['/api/ingest','/api/events','/api/beacon/ingest','/api/device/messages','/api/device/logs','/api/device/settings','/api/device/history-sync'];
const DEVICE_GET=['/api/device/messages','/api/device/settings'];
// Read-only paths a demo account may GET (exercise data only; handlers filter on the exercise flag).
const DEMO_GET=['/api/account','/api/command-center','/api/ops/live','/api/ops/device','/api/ops/place','/api/ops/device-timeline','/api/ops/logs','/api/risk','/api/overlays','/api/feeds'];
export async function onRequest(context){
  const {request,env}=context;const path=new URL(request.url).pathname;const method=request.method;
  // Dedicated public context routes never confer operator/device authority.
  if(['/api/public/feeds','/api/public/overlays','/api/public/news'].includes(path)&&['GET','HEAD'].includes(method))return context.next();
  // 1) public
  if(path==='/api/simulations'&&['GET','HEAD','POST'].includes(method))return context.next();
  if(path==='/api/demo'&&['GET','HEAD'].includes(method))return context.next();
  if(['/api/session','/api/health','/api/ready','/api/weather','/api/recovery','/api/customer/register','/api/customer/login'].includes(path)||(method==='GET'&&path==='/api/customer/me'))return passCustomer(context,path);
  // A dedicated scheduler credential is accepted only by its exact refresh endpoint.
  if(path==='/api/ops/data-refresh'&&method==='POST'&&request.headers.has('X-Data-Job-Key'))return context.next();
  // 2) device keys
  if(request.headers.has('X-Device-Key')&&((method==='POST'&&DEVICE_POST.includes(path))||(method==='GET'&&DEVICE_GET.includes(path))))return context.next();
  // 3) customer paths: never carry operator authority; the handler validates the customer cookie
  if(path.startsWith('/api/customer/'))return passCustomer(context,path);
  // 4) admin key
  if(isAdmin(request,env))return context.next();
  // 5) operator or demo session
  const session=await readSession(request,env);
  if(!session)return json({error:'Sign in to view this data.'},401);
  if(!['GET','HEAD'].includes(method)&&!sameOrigin(request))return json({error:'Request origin is not allowed.'},403);
  if(session.role==='demo'&&!((method==='GET'&&DEMO_GET.includes(path))||(method==='POST'&&path==='/api/layers')))return json({error:'Demo accounts can view exercise data only.'},403);
  context.data.operator=session;
  const headers=new Headers(request.headers);headers.set('Authorization','Bearer '+env.API_ADMIN_KEY);
  return context.next(new Request(request,{headers}));
}
// Strips any Authorization header so an admin key can never ride along into a customer handler.
function passCustomer(context,path){
  if(!path.startsWith('/api/customer/')||!context.request.headers.has('Authorization'))return context.next();
  const headers=new Headers(context.request.headers);headers.delete('Authorization');
  return context.next(new Request(context.request,{headers}));
}
