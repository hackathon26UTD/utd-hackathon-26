import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// The CAD files use Z-up. Center each part in XY, preserve dimensions, then assemble.
export async function mountEnclosure(host, { onReady = () => {} } = {}) {
  let dead = false, renderer, controls, observer, frame;
  const disposables = [];
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let rotating = !motion.matches, visible = true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 1, 2000);
  camera.position.set(315, 240, 340);
  const model = new THREE.Group(); scene.add(model);
  const button = host.parentElement.querySelector('[data-rotation]');
  const reset = host.parentElement.querySelector('[data-reset]');
  const note = host.parentElement.querySelector('[data-model-status]');
  const sync = () => { button.textContent = rotating ? 'Pause rotation' : 'Rotate box'; button.setAttribute('aria-pressed', String(rotating)); };
  const render = () => { if (!dead && renderer) renderer.render(scene, camera); };
  let previous = 0;
  function tick(time) {
    frame = null;
    if (dead || !visible || document.hidden) return;
    if (rotating) model.rotation.y += Math.min((time - (previous || time)) / 1000, .05) * .22;
    previous = time; controls.update(); render();
    if (rotating) frame = requestAnimationFrame(tick);
  }
  const wake = () => { if (!frame && !dead) { previous = 0; frame = requestAnimationFrame(tick); } };
  const toggle = () => { rotating = !rotating; sync(); wake(); };
  const motionChange = () => { if (motion.matches) { rotating = false; sync(); render(); } };
  const visibility = () => { if (!document.hidden) wake(); };
  const stopDrag = () => { rotating = false; sync(); };
  const resetView = () => { camera.position.set(315, 240, 340); controls.target.set(0, 25, 0); model.rotation.y = -.2; controls.update(); render(); };
  const key = event => {
    const directions = { ArrowLeft: -.15, ArrowRight: .15 };
    if (event.key in directions) { event.preventDefault(); rotating = false; sync(); model.rotation.y += directions[event.key]; render(); }
    if (event.key === 'Home') { event.preventDefault(); resetView(); }
  };
  button.addEventListener('click', toggle); reset.addEventListener('click', resetView);
  motion.addEventListener('change', motionChange); document.addEventListener('visibilitychange', visibility);
  sync();
  const cleanup = () => {
    dead = true; cancelAnimationFrame(frame); observer?.disconnect(); resize.disconnect();
    controls?.dispose(); renderer?.dispose();
    disposables.forEach(d => d.dispose());
    button.removeEventListener('click', toggle); reset.removeEventListener('click', resetView);
    motion.removeEventListener('change', motionChange); document.removeEventListener('visibilitychange', visibility);
    host.replaceChildren();
  };
  const resize = new ResizeObserver(() => { if (renderer) { const { width, height } = host.getBoundingClientRect(); renderer.setSize(width, height, false); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); render(); } });
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0, 0);
    host.append(renderer.domElement);
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', 'Your enclosure in 3D, with the lid slightly open. Drag to orbit, scroll to zoom, left and right arrows to rotate, Home to reset.');
    renderer.domElement.addEventListener('keydown', key);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false; controls.minDistance = 270; controls.maxDistance = 800;
    controls.minPolarAngle = .2; controls.maxPolarAngle = Math.PI * .8;
    controls.addEventListener('start', stopDrag); controls.addEventListener('change', render);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x91a29b, 1.8));
    const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(130, 250, 180); scene.add(light);
    const rim = new THREE.DirectionalLight(0xe0f7ee, 1); rim.position.set(-200, 100, -100); scene.add(rim);
    const loader = new STLLoader();
    const parts = await Promise.all(['/models/enclosure-base.stl', '/models/enclosure-lid.stl'].map(url => loader.loadAsync(url)));
    disposables.push(...parts);
    if (dead) { parts.forEach(p => p.dispose()); return cleanup; }
    const material = new THREE.MeshStandardMaterial({ color: 0xcbd4cc, roughness: .54, metalness: .12, side: THREE.DoubleSide });
    const lidMaterial = new THREE.MeshStandardMaterial({ color: 0xe2e8df, roughness: .48, metalness: .1, side: THREE.DoubleSide });
    disposables.push(material, lidMaterial);
    const [base, lid] = parts;
    for (const geometry of parts) {
      geometry.computeBoundingBox(); const b = geometry.boundingBox;
      geometry.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z);
      geometry.rotateX(-Math.PI / 2); geometry.computeVertexNormals(); geometry.computeBoundingBox();
    }
    const baseMesh = new THREE.Mesh(base, material); model.add(baseMesh);
    // Tilt the lid around its rear edge. Opening is illustrative, not a measured sensor state.
    const hinge = new THREE.Group(); hinge.position.set(0, 71, -69.6);
    const lidMesh = new THREE.Mesh(lid, lidMaterial); lidMesh.position.z = 69.6; lidMesh.rotation.x = Math.PI;
    hinge.add(lidMesh); hinge.rotation.x = -.08; model.add(hinge);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(150, 80), new THREE.MeshBasicMaterial({ color: 0xc8d3cb, transparent: true, opacity: .28 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1; scene.add(ground); disposables.push(ground.geometry, ground.material);
    resetView(); resize.observe(host);
    observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) wake(); }); observer.observe(host);
    note.textContent = 'Your enclosure design · drag to explore'; host.dataset.loaded = 'true'; onReady(); wake();
  } catch {
    note.textContent = '3D view unavailable. Your device reports are still available below.';
    button.disabled = true; reset.disabled = true;
  }
  return cleanup;
}
