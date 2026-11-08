import {readFile,writeFile} from 'node:fs/promises';
import {simulationFrame,simulationSchema} from '../domain/simulation.js';
const args=process.argv.slice(2);
if(args.includes('--mcp')){
 const {McpServer}=await import('@modelcontextprotocol/sdk/server/mcp.js');const {StdioServerTransport}=await import('@modelcontextprotocol/sdk/server/stdio.js');const {z}=await import('zod');
 const server=new McpServer({name:'homebeacon-simulations',version:'1.0.0'},{instructions:'Synthetic simulations only. No account credentials or database access. Results illustrate rules, not physical disaster predictions.'});
 const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
 const result=value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
 server.registerTool('homebeacon_simulation_settings',{description:'Read simulation defaults, places and supported event types.',inputSchema:{},annotations},async()=>result(simulationSchema()));
 server.registerTool('homebeacon_run_simulation',{description:'Generate a deterministic isolated synthetic frame. No real device data is read or changed.',inputSchema:{config:z.record(z.string(),z.unknown()).optional(),minute:z.number().int().min(0).max(240).default(0)},annotations},async({config,minute})=>{try{return result(simulationFrame(config,minute));}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}});
 await server.connect(new StdioServerTransport());
}else if(args.includes('--help')){
 console.log('HomeBeacon simulations\n  npm run simulate -- --schema\n  npm run simulate -- --config settings.json --minute 20 --output frame.json\n  npm run simulate -- --mcp\nNo database, browser or credentials required. Settings and seed reproduce the same frame.');
}else{
 try{const flags=new Set(['--schema','--config','--minute','--output']);for(let i=0;i<args.length;i++){if(!flags.has(args[i]))throw Error('Unknown option: '+args[i]);if(args[i]!=='--schema'&&(!args[++i]||args[i].startsWith('--')))throw Error('Missing option value.');}
 const value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
 const path=value('--config');const config=path?JSON.parse(await readFile(path,'utf8')):{};
 const data=args.includes('--schema')?simulationSchema():simulationFrame(config,Number(value('--minute')??0));const json=JSON.stringify(data,null,2)+'\n';
 if(value('--output'))await writeFile(value('--output'),json);else process.stdout.write(json);
 }catch(e){console.error(e.message);process.exitCode=1;}
}
