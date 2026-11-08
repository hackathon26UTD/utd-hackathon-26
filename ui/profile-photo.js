const MIME = ['image/png', 'image/jpeg', 'image/webp'];
// Check declared raster dimensions BEFORE the browser allocates decoded pixels.
function preflight(bytes, type) {
  const b=new Uint8Array(bytes), v=new DataView(bytes), text=(p,n)=>String.fromCharCode(...b.subarray(p,p+n));
  let width=0,height=0;
  if(type==='image/png' && b.length>=33 && [137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n) && text(12,4)==='IHDR') {
    width=v.getUint32(16);height=v.getUint32(20);
    // Avoid animated PNG decoding, including files with misleading first-frame dimensions.
    for(let p=8;p+12<=b.length;) {const n=v.getUint32(p);if(text(p+4,4)==='acTL')throw Error('Choose a still photo.');p+=12+n;}
  } else if(type==='image/jpeg' && b[0]===255 && b[1]===216) {
    for(let p=2;p+4<=b.length;) {
      if(b[p++]!==255) break;while(b[p]===255)p++;
      const marker=b[p++];if(marker===218||marker===217)break;
      if(p+2>b.length)break;const n=v.getUint16(p);if(n<2||p+n>b.length)break;
      if([192,194].includes(marker)&&n>=8) {height=v.getUint16(p+3);width=v.getUint16(p+5);break;}p+=n;
    }
  } else if(type==='image/webp' && b.length>=30 && text(0,4)==='RIFF' && text(8,4)==='WEBP') {
    const tag=text(12,4);
    if(tag==='VP8X') {if(b[20]&2)throw Error('Choose a still photo.');width=1+(b[24]|b[25]<<8|b[26]<<16);height=1+(b[27]|b[28]<<8|b[29]<<16);}
    if(tag==='VP8 ' && text(23,3)==='\x9d\x01\x2a') {width=v.getUint16(26,true)&16383;height=v.getUint16(28,true)&16383;}
    if(tag==='VP8L' && b[20]===47) {const bits=v.getUint32(21,true);width=1+(bits&16383);height=1+((bits>>>14)&16383);}
  }
  if(!width||!height||width>4096||height>4096||width*height>16000000) throw Error('Choose a photo up to 4096 pixels per side and 16 megapixels.');
}
async function smallPhoto(file) {
  if(!MIME.includes(file.type)||file.size>5*1024*1024) throw Error('Choose a PNG, JPEG or WebP photo smaller than 5 MiB.');
  preflight(await file.arrayBuffer(),file.type);
  const bitmap=await createImageBitmap(file);
  try {
    if(bitmap.width>4096||bitmap.height>4096||bitmap.width*bitmap.height>16000000)throw Error('Photo dimensions are too large.');
    const scale=Math.min(1,256/Math.max(bitmap.width,bitmap.height)), canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85));
    if(!blob||blob.size>256*1024)throw Error('Could not make a small photo. Choose another image.');
    return blob;
  } finally {bitmap.close();}
}
/** Mount once per account screen. Call returned cleanup before replacing the screen. */
export function mountProfilePhoto(container,{kind}={}) {
  if(!['customer','operator'].includes(kind)) throw new TypeError('Choose customer or operator.');
  const endpoint=kind==='customer'?'/api/customer/photo':'/api/profile-photo', root=document.createElement('section');
  root.className='kit';root.setAttribute('aria-label','Profile photo');
  const image=document.createElement('img');image.alt='Your profile photo';image.width=64;image.height=64;image.hidden=true;image.style.cssText='border-radius:50%;object-fit:cover;display:none';
  const label=document.createElement('label');label.className='kit-field';label.textContent='Upload profile photo';
  const input=document.createElement('input');input.type='file';input.accept=MIME.join(',');input.className='kit-input';label.append(input);
  const remove=document.createElement('button');remove.type='button';remove.className='kit-btn';remove.textContent='Remove photo';remove.disabled=true;
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const help=document.createElement('p');help.textContent='PNG, JPEG or WebP, up to 5 MiB. Resized to 256 pixels before upload.';
  const id=`photo-help-${crypto.randomUUID()}`;help.id=id;input.setAttribute('aria-describedby',id);
  root.append(image,label,remove,help,status);container.append(root);
  const controller=new AbortController();let disposed=false,url=null,hasPhoto=false,busy=false;
  const say=text=>{if(!disposed)status.textContent=text;};
  function controls(value){busy=value;input.disabled=value;remove.disabled=value||!hasPhoto;root.setAttribute('aria-busy',String(value));}
  function show(blob) {
    if(url)URL.revokeObjectURL(url);url=null;hasPhoto=!!blob;
    image.hidden=!blob;image.style.display=blob?'block':'none';
    if(blob){url=URL.createObjectURL(blob);image.src=url;}else image.removeAttribute('src');
  }
  async function call(method,body) {
    const response=await fetch(endpoint,{method,body,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:body?{'Content-Type':body.type}:{}});
    if(response.status===404&&method==='GET')return null;
    if(!response.ok) throw Error(response.status===401?'Sign in to manage your profile photo.':response.status===403?'This account cannot change profile photos.':'Could not update the photo. Try again.');
    return response;
  }
  input.addEventListener('change',async()=>{
    const file=input.files?.[0];if(!file||busy)return;controls(true);say('Preparing photo…');
    try {const blob=await smallPhoto(file);if(disposed)return;await call('PUT',blob);if(disposed)return;show(blob);say('Profile photo saved.');}
    catch(error){if(!disposed)say(error.message);}finally{input.value='';if(!disposed)controls(false);}
  });
  remove.addEventListener('click',async()=>{
    if(busy)return;controls(true);say('Removing photo…');
    try{await call('DELETE');if(disposed)return;show(null);say('Profile photo removed.');}
    catch(error){if(!disposed)say(error.message);}finally{if(!disposed)controls(false);}
  });
  controls(true);say('Loading profile photo…');
  (async()=>{try{const response=await call('GET');const blob=response?await response.blob():null;if(disposed)return;show(blob);say(blob?'Profile photo loaded.':'No profile photo.');}catch(error){if(!disposed)say(error.message);}finally{if(!disposed)controls(false);}})();
  return ()=>{disposed=true;controller.abort();if(url)URL.revokeObjectURL(url);root.remove();};
}
