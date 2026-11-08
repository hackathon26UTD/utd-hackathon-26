const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const rounded=v=>typeof v==='number'&&Number.isFinite(v)?String(Math.round(v*100)/100):'Not recorded';
export function openDeviceHistory(id,{customer=false}={}){
 const body=el('div',null,'device-history-body'),status=el('p','Loading history…'),content=el('div');status.setAttribute('role','status');body.append(status,content);
 const popup=window.Kit.popUpWindow({title:'History and usual readings',body,close:true});let generation=0;
 const range=window.Kit.select({value:'30',options:[7,30,90,365].map(n=>({value:String(n),label:n+' days'})),onChange:()=>load()});range.querySelector('button').setAttribute('aria-label','Cloud summary range');body.prepend(range);
 async function load(){const request=++generation;status.textContent='Loading history…';content.replaceChildren();
  try{const response=await fetch((customer?'/api/customer/history':'/api/ops/device-history')+'?'+new URLSearchParams({id,days:range.kitValue()}),{credentials:'same-origin'});const data=await response.json();if(request!==generation)return;if(!response.ok)throw Error(data.error||'History could not load.');
   status.textContent=(data.daily?.length||0)+' cloud-summary days · '+(data.local?.samples?.length||0)+' retained box readings';
   const local=data.local||{},localMetrics=Object.values(local.metrics||{}).filter(m=>m?.count>0);
   if(local.samples?.length||localMetrics.length){
    content.append(el('h3','From the box'),el('p',(local.samples?.length||0)+' retained readings synced.'+(local.overwritten?' The box replaced '+local.overwritten+' older snapshots as its storage filled.':'')));
    if(localMetrics.length){content.append(el('h4','Box’s usual readings'),window.Kit.details({items:localMetrics.map(m=>({label:m.label,value:rounded(m.mean)+' '+m.unit,sub:m.count+' samples · '+(m.status==='device_reported_reference'?'Recorded reference':'Still learning')}))}));}
    const info=el('details');info.append(el('summary','How this is learned'),el('p','The box keeps averages from eligible readings while offline. These are device-reported references, not safe limits. Fixed alarms do not change. The local snapshot record is bounded and may have gaps.'));content.append(info);
    const localRows=el('details');localRows.append(el('summary','Retained box readings'));const scroll=el('div');scroll.style.overflowX='auto';scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Recorded readings table');const table=el('table',null,'history-table'),head=el('thead'),header=el('tr');for(const title of ['Observed','Water ADC','Flame ADC','Movement mg','Battery mV'])header.append(el('th',title));head.append(header);table.append(head);const tbody=el('tbody');for(const sample of local.samples||[]){const row=el('tr');for(const value of [sample.observedAt?new Date(sample.observedAt).toLocaleString():'Time unknown',sample.flags&4096?sample.waterRaw:'Not recorded',sample.flags&512?sample.flameRaw:'Not recorded',sample.flags&8192?sample.accelMilliG:'Not recorded',sample.batteryMv||'Not recorded'])row.append(el('td',value));tbody.append(row);}table.append(tbody);scroll.append(table);localRows.append(scroll);content.append(localRows);
   }
   if(!data.daily?.length&&local.samples?.length){content.append(el('p','No cloud daily summaries yet. Retained box readings are shown above.','fine'));return;}
   const baseline=data.baseline||{};content.append(el('h3',baseline.status==='observed_reference'?'Usual recorded range':'Still learning the usual range'),el('p',baseline.status==='observed_reference'?'Averages from eligible reports. Fixed alarms stay in place.':'More eligible reports are needed before showing a reference.'));
   const limits=el('details');limits.append(el('summary','About these averages'),el('p',baseline.note||'Recorded averages are context, not safety limits.'));content.append(limits);
   const metrics=Object.values(baseline.metrics||{}).filter(m=>m&&m.count>0);
   if(metrics.length)content.append(window.Kit.details({items:metrics.map(m=>({label:m.label||m.sensor||'Sensor',value:rounded(m.mean)+' '+(m.unit||''),sub:m.count+' eligible '+(m.count===1?'sample':'samples')+' · '+(m.status==='observed_reference'?'Recorded reference':'Still learning')+' · '+rounded(m.min)+' to '+rounded(m.max)}))}));
   const details=el('details');details.append(el('summary','Daily records'));const scroll=el('div');scroll.style.overflowX='auto';scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Recorded readings table');const table=el('table');table.className='history-table';const head=el('thead'),tr=el('tr');for(const label of ['Day','Sensor','Average','Range','Samples'])tr.append(el('th',label));head.append(tr);table.append(head);const rows=el('tbody');
   for(const day of [...(data.daily||[])].reverse())for(const [sensor,m]of Object.entries(day.metrics||{})){if(!m||!m.count)continue;const row=el('tr');for(const value of [day.day,m.label||sensor,rounded(m.mean)+' '+(m.unit||''),rounded(m.min)+' – '+rounded(m.max),m.count])row.append(el('td',value));rows.append(row);}
   table.append(rows);scroll.append(table);details.append(scroll);content.append(details,el('p','Daily averages can include event readings. Only eligible samples contribute to the usual-range reference. Fixed alerts stay in place.','fine'));
  }catch(e){if(request===generation)status.textContent=e.message;}
 }
 load();return popup;
}
