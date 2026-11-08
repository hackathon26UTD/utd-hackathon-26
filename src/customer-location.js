import { HttpError } from './http.js';
// Census returns an address-range location, not a verified rooftop or occupancy.
export async function matchCustomerAddress(address, fetcher = fetch) {
  if (typeof address !== 'string' || address.trim().length < 8 || address.length > 300) throw new HttpError(400, 'Enter the full street address, city, state and ZIP.');
  const q = new URLSearchParams({address:address.trim(),benchmark:'Public_AR_Current',format:'json'});
  let r;
  try { r=await fetcher('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?'+q,{signal:AbortSignal.timeout(8000),redirect:'error'}); }
  catch { throw new HttpError(503,'Address lookup is unavailable. Try again shortly.'); }
  if(!r.ok) throw new HttpError(503,'Address lookup is unavailable. Try again shortly.');
  const matches=(await r.json()).result?.addressMatches || [];
  if(matches.length!==1) throw new HttpError(400,'Address could not be matched uniquely. Check the street, city, state and ZIP.');
  const m=matches[0], c=[m.coordinates?.x,m.coordinates?.y];
  if(!c.every(Number.isFinite)||c[0]<-125.1||c[0]>-66.8||c[1]<24.3||c[1]>49.6) throw new HttpError(400,'Enter an address in the lower 48 states.');
  return {address:String(m.matchedAddress).slice(0,300),location:{type:'Point',coordinates:c},locationSource:'US Census address match'};
}
