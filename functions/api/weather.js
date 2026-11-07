const headers={'User-Agent':'HomeBeaconHackUTD/1.0 (https://github.com/hackathon26UTD)','Accept':'application/geo+json,application/json'};
async function source(name,url){try{const response=await fetch(url,{headers,signal:AbortSignal.timeout(7000)});if(!response.ok)throw new Error('unavailable');return {name,status:'available',fetchedAt:new Date().toISOString(),data:await response.json()};}catch{return {name,status:'unavailable',fetchedAt:null,data:null};}}
export async function onRequestGet(){
  const [nws,usgs,fema]=await Promise.all([
    source('National Weather Service','https://api.weather.gov/alerts/active?area=TX'),
    source('USGS earthquakes','https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'),
    source('FEMA declarations',"https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=state%20eq%20%27TX%27&$orderby=declarationDate%20desc&$top=5"),
  ]);
  const weather={type:'FeatureCollection',features:(nws.data?.features||[]).slice(0,100).map(f=>({type:'Feature',id:f.id,geometry:f.geometry,properties:{event:f.properties?.event,severity:f.properties?.severity,headline:f.properties?.headline,areaDesc:f.properties?.areaDesc,sent:f.properties?.sent,expires:f.properties?.expires,description:f.properties?.description}}))};
  const earthquakes={type:'FeatureCollection',features:(usgs.data?.features||[]).filter(f=>f.geometry?.coordinates?.[0]>=-107&&f.geometry?.coordinates?.[0]<=-93&&f.geometry?.coordinates?.[1]>=25&&f.geometry?.coordinates?.[1]<=37).map(f=>({type:'Feature',geometry:f.geometry,properties:{title:f.properties?.title,mag:f.properties?.mag,time:f.properties?.time,url:f.properties?.url}}))};
  return Response.json({weather,earthquakes,declarations:(fema.data?.DisasterDeclarationsSummaries||[]).map(d=>({title:d.declarationTitle,date:d.declarationDate,type:d.incidentType,area:d.designatedArea})),sources:[nws,usgs,fema].map(({name,status,fetchedAt})=>({name,status,fetchedAt})),note:'Weather alerts and declarations are regional context, not proof of property damage.'},{headers:{'Cache-Control':'public, max-age=120'}});
}
