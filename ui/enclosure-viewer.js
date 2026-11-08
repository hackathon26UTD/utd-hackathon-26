import {addCircuit} from './enclosure-circuit.js';
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// The CAD files use Z-up. Center each part in XY, preserve dimensions, then assemble.
export async function mountEnclosure(host, { onReady = () => {} } = {}) {
  let dead = false, renderer, controls, observer, frame, lidMesh, pointerStart;
  const disposables = [];
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let rotating = !motion.matches, visible = true, hinge, lidAngle = -.15, lidTarget = -.15;
  const scene = new THREE.Scene();
  // A real 3D floor grid is depth-occluded by the enclosure, never painted on its surfaces.
  const floorGrid = new THREE.GridHelper(700,28);
  const floorMaterial = new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,
    uniforms:{tint:{value:new THREE.Color()},alpha:{value:.24}},
    vertexShader:'varying vec2 floorPosition; void main(){floorPosition=position.xz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'uniform vec3 tint; uniform float alpha; varying vec2 floorPosition; void main(){gl_FragColor=vec4(tint,alpha*(1.0-smoothstep(140.0,340.0,length(floorPosition))));}',
  });
  floorGrid.material.dispose();floorGrid.material=floorMaterial;floorGrid.position.y=-1.3;scene.add(floorGrid);
  disposables.push(floorGrid.geometry,floorMaterial);
  const syncFloorTheme = () => {
    const dark=document.documentElement.dataset.hbkitTheme==='dark';
    floorMaterial.uniforms.tint.value.set(dark?0xaaaaaa:0x777777);
    floorMaterial.uniforms.alpha.value=dark?.27:.25;
    if(renderer&&!dead)renderer.render(scene,camera);
  };
  const themeObserver=new MutationObserver(syncFloorTheme);
  themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-hbkit-theme']});
  syncFloorTheme();
  const camera = new THREE.PerspectiveCamera(34, 1, 1, 2000);
  camera.position.set(310, 255, 360);
  const model = new THREE.Group(); scene.add(model);
  const note = host.parentElement.querySelector('[data-model-status]');
  const render = () => {
    if (dead || !renderer) return;
    renderer.render(scene, camera);

  };
  let previous = 0;
  function tick(time) {
    frame = null;
    if (dead || !visible || document.hidden) return;
    if (rotating) model.rotation.y += Math.min((time - (previous || time)) / 1000, .05) * .22;
    previous = time;
    if (hinge) { lidAngle += (lidTarget-lidAngle) * .14; if (Math.abs(lidAngle-lidTarget)<.002) lidAngle=lidTarget; hinge.rotation.x=lidAngle; }
    controls.update(); render();
    if (rotating || Math.abs(lidAngle-lidTarget)>.001) frame = requestAnimationFrame(tick);
  }
  const wake = () => { if (!frame && !dead) { previous = 0; frame = requestAnimationFrame(tick); } };
  const toggle = () => { rotating = !rotating; wake(); };
  const motionChange = () => { if (motion.matches) { rotating = false; render(); } };
  const visibility = () => { if (!document.hidden) wake(); };
  const stopDrag = () => { rotating = false; };
  const resetView = () => { camera.position.set(310, 255, 360); controls.target.set(0, 52, 0); model.rotation.y = -.2; controls.update(); render(); };
  const key = event => {
    const directions = { ArrowLeft: -.15, ArrowRight: .15 };
    if (event.key in directions) { event.preventDefault(); rotating = false; model.rotation.y += directions[event.key]; render(); }
    if (event.key === 'Enter') {event.preventDefault();changeLid();}
    if (event.key === ' ') {event.preventDefault();toggle();}
    if (event.key === 'Home') { event.preventDefault(); resetView(); }
  };
  const changeLid = () => {
    const open = lidTarget > -.5; lidTarget = open ? -1.65 : 0;
    if (motion.matches) { lidAngle=lidTarget; if (hinge) hinge.rotation.x=lidAngle; }
    renderer?.domElement.setAttribute('aria-expanded',String(open));
    host.dataset.lid = open ? 'open' : 'closed'; wake();
  };
  motion.addEventListener('change', motionChange); document.addEventListener('visibilitychange', visibility);

  const cleanup = () => {
    dead = true; themeObserver.disconnect(); cancelAnimationFrame(frame); observer?.disconnect(); resize.disconnect();
    controls?.dispose(); renderer?.dispose();
    disposables.forEach(d => d.dispose());
    motion.removeEventListener('change', motionChange); document.removeEventListener('visibilitychange', visibility);
    host.replaceChildren();
  };
  const down = e => {pointerStart={x:e.clientX,y:e.clientY};};
  const up = e => {
    if(!lidMesh || !pointerStart || Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>6)return;
    const r=renderer.domElement.getBoundingClientRect();
    const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),camera);
    if(ray.intersectObject(lidMesh).length)changeLid();
  };
  const resize = new ResizeObserver(() => { if (renderer) { const { width, height } = host.getBoundingClientRect(); renderer.setSize(width, height, false); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); render(); } });
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0, 0);
    host.append(renderer.domElement);
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('aria-expanded','false');
    renderer.domElement.setAttribute('role', 'button');
    renderer.domElement.setAttribute('aria-label', 'Your box in 3D. Tap its lid or press Enter to open and close. Drag to turn, scroll to zoom. Space pauses rotation.');
    renderer.domElement.addEventListener('keydown', key);
    renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',up);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false; controls.minDistance = 270; controls.maxDistance = 800;
    controls.minPolarAngle = .2; controls.maxPolarAngle = Math.PI * .8;
    controls.addEventListener('start', stopDrag); controls.addEventListener('change', render);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xa2a2a2, 1.8));
    const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(130, 250, 180); scene.add(light);
    const rim = new THREE.DirectionalLight(0xffffff, 1); rim.position.set(-200, 100, -100); scene.add(rim);
    const loader = new STLLoader();
    const parts = await Promise.all(['/models/enclosure-base.stl', '/models/enclosure-lid.stl'].map(url => loader.loadAsync(url)));
    disposables.push(...parts);
    if (dead) { parts.forEach(p => p.dispose()); return cleanup; }
    const material = new THREE.MeshStandardMaterial({ color: 0xc9cbce, roughness: .54, metalness: .12, side: THREE.DoubleSide });
    const lidMaterial = new THREE.MeshStandardMaterial({ color: 0xd92724, roughness: .48, metalness: .1, side: THREE.DoubleSide });
    disposables.push(material, lidMaterial);
    const [base, lid] = parts;
    // Native CAD hinge cylinders: base axis Y=134.7,Z=56.5; lid axis Y=4.5,Z=4.5.
    // The lid's hinge is on its low-Y edge (the opposite edge contains latch tabs).
    // Flip around native X so the hinge knuckles interleave and posts face inward.
    base.translate(-93.8,-65.8,0); base.rotateX(-Math.PI/2);
    lid.translate(-92,-4.5,-4.5); lid.rotateX(Math.PI/2);
    for(const geometry of parts){geometry.computeVertexNormals();geometry.computeBoundingBox();}
    model.add(new THREE.Mesh(base, material));
    hinge = new THREE.Group(); hinge.position.set(0,56.5,-68.9);
    lidMesh=new THREE.Mesh(lid,lidMaterial);hinge.add(lidMesh); hinge.rotation.x=lidAngle; model.add(hinge);
    addCircuit(model,disposables);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(180, 80), new THREE.MeshBasicMaterial({ color: 0xa4a6aa, transparent: true, opacity: .12 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1; scene.add(ground); disposables.push(ground.geometry, ground.material);
    resetView(); resize.observe(host);
    observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) wake(); }); observer.observe(host);
    note.textContent = 'Tap the lid to look inside'; host.dataset.loaded = 'true'; onReady(); wake();
  } catch {
    note.textContent = '3D view unavailable. Your device reports are still available below.';
    host.dataset.error='true';
  }
  return cleanup;
}
