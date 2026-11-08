import { allowsMotion } from '../display-settings.js';

// Forecast motion stays near its sample point. It does not invent a continuous field.
export function windSamples(features=[]) {
  return features.filter(f=>f?.geometry?.type==='Point' && f.geometry.coordinates?.length>=2 && f.geometry.coordinates.slice(0,2).every(Number.isFinite)
    && Number.isFinite(f.properties?.wind_kph) && f.properties.wind_kph>=0
    && Number.isFinite(f.properties?.wind_direction) && f.properties.wind_direction>=0 && f.properties.wind_direction<=360)
    .slice(0,100).map(f=>({coordinates:f.geometry.coordinates.slice(0,2),speed:f.properties.wind_kph,direction:f.properties.wind_direction}));
}

// Illustration-only weather for public scenario playback. Never written to device values.
export function simulationWind(id,config,minute) {
  const speed=config ? (config.event==='wind'&&Number.isFinite(minute)&&minute>=config.eventStartMin&&minute<config.eventEndMin?config.windKph:0) : ({normal:12,'power-outage':30,'water-hurricane':95,recovery:18}[id] ?? 0);
  const centers=config?.center?[config.center]:[[-82.46,27.96],[-96.76,32.98]];
  const span=config?.affectedRadiusKm?config.affectedRadiusKm/111:0;
  return centers.flatMap(center=>Array.from({length:25},(_,i)=>({
    coordinates:[center[0]+(i%5-2)*(config?span/(2*Math.cos(center[1]*Math.PI/180)):.18),center[1]+(Math.floor(i/5)-2)*(config?span/2:.14)],
    speed:Number.isFinite(speed)?speed:0,direction:225,
  })));
}

export function mountWindFlow(view) {
  const map=view.map, canvas=document.createElement('canvas');
  canvas.className='wind-flow';canvas.setAttribute('aria-hidden','true');canvas.dataset.running='false';
  canvas.style.cssText='position:absolute;inset:0;pointer-events:none;width:100%;height:100%;';
  map.getCanvasContainer().append(canvas);
  const ctx=canvas.getContext('2d');
  let frame=0,visible=true,paused=false,disposed=false,last=0,phase=0;
  const samples=()=>view.simulationWind ?? windSamples(view.ext.atmosphere?.features);
  const enabled=()=>view.worldKey==='wind'&&(view.simulationWind!==undefined||view.visible.has('atmosphere'));
  function draw(now=0) {
    frame=0;if(disposed)return;
    const w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,2);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const points=enabled()?samples():[], moving=enabled()&&!paused&&visible&&!document.hidden&&allowsMotion()&&points.some(p=>p.speed>0);
    canvas.dataset.running=String(moving);canvas.dataset.samples=String(points.length);
    if(moving){phase+=Math.min(50,Math.max(0,now-last))/1000;last=now;}else last=0;
    const labels=[],drawn=[];
    for(let i=0;i<points.length;i++) {
      const sample=points[i],p=map.project(sample.coordinates);
      if(p.x < -70 || p.x>w+70 || p.y < -70 || p.y>h+70)continue;
      if(drawn.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<75))continue;drawn.push(p);
      // Meteorological direction is FROM north; screen trails travel downwind.
      const angle=(sample.direction+180-map.getBearing())*Math.PI/180,dx=Math.sin(angle),dy=-Math.cos(angle);
      const count=view.simulationWind?18:12;
      if(sample.speed>0)for(let j=0;j<count;j++) {
        const t=((phase*(.12+Math.min(sample.speed,150)/180)+j*.618+i*.173)%1);
        const cross=((j*23+i*7)%70)-35,along=(t-.5)*100;
        const x=p.x+dx*along-dy*cross,y=p.y+dy*along+dx*cross;
        ctx.strokeStyle=`rgba(235,248,255,${(.2+.65*Math.sin(t*Math.PI)).toFixed(3)})`;ctx.lineWidth=1.2;ctx.lineCap='round';
        ctx.beginPath();ctx.moveTo(x-dx*12,y-dy*12);ctx.lineTo(x,y);ctx.stroke();
      }
      // Real forecasts retain their MapLibre labels and source click targets.
      if(view.simulationWind&&p.x>40&&p.x<w-40&&p.y>30&&p.y<h-35&&!labels.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<105)) {
        labels.push({...p,text:Math.round(sample.speed)+' km/h'});
      }
    }
    // Label plates are painted last, so flow never runs over the numbers.
    ctx.font='600 13px sans-serif';ctx.textAlign='center';
    for(const p of labels){
      const width=ctx.measureText(p.text).width+16;
      ctx.fillStyle='#123e6e';ctx.beginPath();ctx.roundRect(p.x-width/2,p.y-11,width,24,6);ctx.fill();
      ctx.fillStyle='#fff';ctx.fillText(p.text,p.x,p.y+5);
    }
    if(moving)frame=requestAnimationFrame(tick);
  }
  function tick(now){if(now-last<32){frame=requestAnimationFrame(tick);return;}draw(now);}
  function update(){if(frame)cancelAnimationFrame(frame);frame=0;draw(performance.now());}
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;update();});observer.observe(canvas);
  const resize=new ResizeObserver(update);resize.observe(canvas);
  const media=matchMedia('(prefers-reduced-motion: reduce)');media.addEventListener('change',update);
  document.addEventListener('visibilitychange',update);document.addEventListener('homebeacon:motion',update);
  window.addEventListener('storage',update);map.on('move',update);
  const destroy=()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();resize.disconnect();media.removeEventListener('change',update);document.removeEventListener('visibilitychange',update);document.removeEventListener('homebeacon:motion',update);window.removeEventListener('storage',update);map.off('move',update);canvas.remove();};
  map.once('remove',destroy);
  return {update,setPaused(value){paused=!!value;update();},get paused(){return paused;},destroy};
}
