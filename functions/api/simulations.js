import {simulationFrame,simulationSchema} from '../../domain/simulation.js';
const headers={'Cache-Control':'no-store','X-HomeBeacon-Data':'synthetic'};
export async function onRequest({request}){
 if(['GET','HEAD'].includes(request.method))return new Response(request.method==='HEAD'?null:JSON.stringify(simulationSchema()),{headers:{...headers,'Content-Type':'application/json'}});
 if(request.method!=='POST')return Response.json({error:'Use GET for settings or POST for a simulation frame.'},{status:405,headers:{...headers,Allow:'GET, HEAD, POST'}});
 try{
  if(Number(request.headers.get('content-length'))>16384)throw new RangeError('Settings are too large.');
  const reader=request.body?.getReader();let text='',size=0;const decoder=new TextDecoder();
  if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw new RangeError('Settings are too large.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  const body=JSON.parse(text);if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!['config','minute'].includes(k)))throw new RangeError('Provide config and minute.');
  return Response.json(simulationFrame(body.config,body.minute??0),{headers});
 }catch(e){return Response.json({error:e instanceof RangeError?e.message:'Enter valid simulation settings.'},{status:400,headers});}
}
