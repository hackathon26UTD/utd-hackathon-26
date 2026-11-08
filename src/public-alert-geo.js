import {geometryBbox,bboxIntersects} from './feed-geo.js';
import {pointInGeometry,inBbox} from './risk/geo.js';
// Rectangle/area intersection, including disjoint counties and polygon holes.
export function alertIntersects(geometry,box){
 const bounds=geometryBbox(geometry);if(!bounds||!bboxIntersects(bounds,box))return false;
 const [w,s,e,n]=box;
 if([[w,s],[w,n],[e,s],[e,n]].some(p=>pointInGeometry(p,geometry)))return true;
 const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
 return polygons.some(rings=>rings.some(ring=>ring.some((a,i)=>{
  if(inBbox(a,box))return true;const b=ring[(i+1)%ring.length];let low=0,high=1;
  for(let axis=0;axis<2;axis++){const delta=b[axis]-a[axis],min=box[axis],max=box[axis+2];if(delta===0){if(a[axis]<min||a[axis]>max)return false;}else{const t1=(min-a[axis])/delta,t2=(max-a[axis])/delta;low=Math.max(low,Math.min(t1,t2));high=Math.min(high,Math.max(t1,t2));if(low>high)return false;}}
  return true;
 })));
}
