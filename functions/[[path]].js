import {metadata} from '../src/customer-oauth.js';
export function onRequest(ctx){
 const path=new URL(ctx.request.url).pathname;
 if(path==='/.well-known/oauth-authorization-server')return metadata(ctx.request);
 if(path==='/.well-known/oauth-protected-resource'||path==='/.well-known/oauth-protected-resource/mcp')return metadata(ctx.request,true);
 return ctx.next();
}
