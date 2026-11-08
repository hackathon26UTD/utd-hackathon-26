import * as THREE from 'three';

// A designed internal visualization, not a scan or wiring guide for the physical kit.
export function addCircuit(model, resources) {
  const group = new THREE.Group(); model.add(group);
  const mats = Object.fromEntries(Object.entries({pcb:0x144d40,chip:0x182329,metal:0xaab9b7,copper:0xc5a263,white:0xe4eadc,blue:0x367b9c,wire:0xc8844f}).map(([k,color])=>{
    const m=new THREE.MeshStandardMaterial({color,roughness:.48,metalness:k==='metal'||k==='copper'?.7:.15});resources.push(m);return[k,m];
  }));
  const box=(x,y,z,w,h,d,mat)=>{const geo=new THREE.BoxGeometry(w,h,d);resources.push(geo);const mesh=new THREE.Mesh(geo,mats[mat]);mesh.position.set(x,y,z);group.add(mesh);return mesh;};
  box(0,13,0,150,2,100,'pcb');
  box(-24,20,-7,40,10,35,'chip'); box(28,19,-22,29,8,28,'metal');
  box(-45,20,29,30,10,18,'blue');
  for(let i=0;i<8;i++) { box(-41+i*4,26,-7,1.2,3,27,'metal'); }
  for(let i=0;i<6;i++) { box(22+i*2.2,24,-22,1,2,22,'metal'); }
  for(let i=0;i<5;i++) {box(-7+i*12,16,40,5,3,3,'copper');box(-7+i*12,16,-41,5,3,3,'copper');}
  box(53,18,-12,17,6,14,'white');box(53,22,-12,11,2,8,'chip');
  box(38,21,29,40,14,17,'chip');
  for(let i=0;i<9;i++){box(-47+i*5,16,-34,2,4,7,'metal');box(-47+i*5,16,18,2,4,7,'metal');}
  for(let i=0;i<7;i++){box(13+i*5,16,0,2,4,6,'copper');box(-61,17,-27+i*8,5,5,3,'white');}
  for(const x of [-67,67]) for(const z of [-42,42]){const geo=new THREE.CylinderGeometry(3,3,8,16);resources.push(geo);const m=new THREE.Mesh(geo,mats.metal);m.position.set(x,8,z);group.add(m);}
  // Copper traces route around components in orthogonal paths.
  for(let i=0;i<12;i++){
    const z=-42+i*7, x=-56+i*8;
    const pts=[new THREE.Vector3(-69,14.1,z),new THREE.Vector3(x,14.1,z),new THREE.Vector3(x,14.1,42)];
    const geo=new THREE.BufferGeometry().setFromPoints(pts);const mat=new THREE.LineBasicMaterial({color:0x91b09a,transparent:true,opacity:.7});resources.push(geo,mat);group.add(new THREE.Line(geo,mat));
  }
  for(const [x,z] of [[-56,-37],[56,37]]){const geo=new THREE.SphereGeometry(1.8,12,8),mat=new THREE.MeshBasicMaterial({color:0x8cedba});resources.push(geo,mat);const led=new THREE.Mesh(geo,mat);led.position.set(x,17,z);group.add(led);}
  const wirePoints=[new THREE.Vector3(40,27,30),new THREE.Vector3(55,39,20),new THREE.Vector3(67,33,-15),new THREE.Vector3(57,18,-30)];
  const wireGeo=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wirePoints),30,1,8,false);resources.push(wireGeo);group.add(new THREE.Mesh(wireGeo,mats.wire));
  return group;
}
