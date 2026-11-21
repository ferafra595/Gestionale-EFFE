// One-account Meta Insights pilot. Authenticated by EFFE's existing /api/* session middleware.
// Read-only: no D1 writes, no publishing, never returns the access token or raw Meta errors.
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'private, no-store, max-age=0',
  'x-content-type-options':'nosniff'
}});
const day=/^\d{4}-\d{2}-\d{2}$/;
const idPattern=/^\d{5,30}$/;
const goodDay=s=>day.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function dayRange(request){
  const url=new URL(request.url),now=new Date();
  const today=now.toISOString().slice(0,10);
  const since=url.searchParams.get('since')||today.slice(0,7)+'-01';
  const until=url.searchParams.get('until')||today;
  if(!goodDay(since)||!goodDay(until)||since>=until||
    (Date.parse(until+'T00:00:00Z')-Date.parse(since+'T00:00:00Z'))/86400000>93)
    return null;
  return {since,until};
}
async function meta(path,params,token){
  const url=new URL('https://graph.facebook.com/v27.0/'+path);
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9500);
  try{
    const response=await fetch(url,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:controller.signal,redirect:'error'});
    const body=await response.json().catch(()=>null);
    if(!response.ok||!body||body.error){
      const status=Number(body?.error?.code)||null;
      return {ok:false,error:response.status===401||status===190?'token_expired':'meta_rejected',status};
    }
    return {ok:true,body};
  }catch(_){return {ok:false,error:'network_error',status:null}}
  finally{clearTimeout(timer)}
}
function numericTotal(body,name){
  const row=(body?.data||[]).find(x=>x.name===name);
  if(!row)return {value:null,available:false};
  const n=row?.total_value?.value;
  return typeof n==='number'&&Number.isFinite(n)&&n>=0?{value:n,available:true}:{value:null,available:false};
}
export async function onRequestGet({request,env}){
  const id=String(env.META_IG_USER_ID||'').trim(),token=String(env.META_IG_ACCESS_TOKEN||'').trim();
  if(!id||!token)return json({connected:false,status:'not_configured',message:'Configura META_IG_USER_ID e META_IG_ACCESS_TOKEN in Cloudflare Production.'});
  if(!idPattern.test(id))return json({connected:false,status:'invalid_configuration',message:'ID account Instagram non valido.'},400);
  const range=dayRange(request);
  if(!range)return json({connected:false,status:'invalid_period',message:'Specificare un intervallo valido, massimo 93 giorni, con fine esclusiva.'},400);
  const [profile,reach,views,interactions]=await Promise.all([
    meta(encodeURIComponent(id),{fields:'id,username,followers_count,media_count'},token),
    meta(encodeURIComponent(id)+'/insights',{metric:'reach',period:'day',metric_type:'total_value',...range},token),
    meta(encodeURIComponent(id)+'/insights',{metric:'views',period:'day',metric_type:'total_value',...range},token),
    meta(encodeURIComponent(id)+'/insights',{metric:'total_interactions',period:'day',metric_type:'total_value',...range},token)
  ]);
  if(!profile.ok)return json({connected:false,status:profile.error,meta_code:profile.status,
    message:'Impossibile leggere il profilo Meta. Controlla autorizzazioni e validità del token.'},502);
  if(String(profile.body?.id)!==id)return json({connected:false,status:'id_mismatch',message:'L’account restituito da Meta non coincide con quello configurato.'},502);
  const metrics={
    followers_count:typeof profile.body.followers_count==='number'?profile.body.followers_count:null,
    media_count:typeof profile.body.media_count==='number'?profile.body.media_count:null,
    reach:reach.ok?numericTotal(reach.body,'reach').value:null,
    views:views.ok?numericTotal(views.body,'views').value:null,
    total_interactions:interactions.ok?numericTotal(interactions.body,'total_interactions').value:null
  };
  return json({connected:true,status:'ok',account:{id,username:profile.body.username||null},
    period:{...range,until_exclusive:true},metrics,
    checks:{reach:reach.ok?'ok':reach.error,views:views.ok?'ok':views.error,
      total_interactions:interactions.ok?'ok':interactions.error},
    retrieved_at:new Date().toISOString(),
    notes:['I follower e i contenuti sono valori attuali, non totali del periodo.',
      'La reach aggregata può essere zero. Non sostituirla con una somma di valori giornalieri.',
      'Questa lettura non registra alcun dato nel database e non genera report per i clienti.']});
}
export async function onRequest(){return json({error:'Metodo non consentito'},405)}
