// EFFE Social Insights — multi-client, admin-session-only. No client tokens in D1.
// All writes occur on explicit POST actions; existing reports are never overwritten.
const response=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'private, no-store, max-age=0',
  'x-content-type-options':'nosniff'
}});
const validId=id=>/^\d{5,30}$/.test(String(id||''));
const validMonth=month=>/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month||''))&&String(month)>='2024-01';
const tokenFrom=env=>String(env.META_IG_ACCESS_TOKEN||'').trim();
function monthWindow(month){
  const [year,number]=month.split('-').map(Number);
  const until=new Date(Date.UTC(year,number,1)).toISOString().slice(0,10);
  const today=new Date().toISOString().slice(0,10);
  return {since:month+'-01',until:until<today?until:today};
}
async function meta(path,params,token){
  const url=new URL('https://graph.facebook.com/v27.0/'+path);
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);
  try{
    const r=await fetch(url,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      redirect:'manual',signal:ctrl.signal});
    if(r.status>=300&&r.status<400)return {ok:false,code:'redirect',http:r.status};
    const d=await r.json().catch(()=>null);
    if(!r.ok||!d||d.error)return {ok:false,code:d?.error?.code===190?'expired':'unavailable',
      http:r.status,meta_code:Number(d?.error?.code)||null};
    return {ok:true,data:d};
  }catch(_){return {ok:false,code:'network',http:null}}
  finally{clearTimeout(timer)}
}
async function tables(db){
  const r=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('social_meta_accounts','social_meta_months')").all();
  const names=new Set((r.results||[]).map(x=>x.name));
  return names.has('social_meta_accounts')&&names.has('social_meta_months');
}
async function accounts(db){
  const r=await db.prepare(`SELECT a.id,a.client_id,c.name AS client_name,a.ig_user_id,a.fb_page_id,a.username,a.updated_at
    FROM social_meta_accounts a JOIN clients c ON c.id=a.client_id ORDER BY c.name`).all();
  return r.results||[];
}
async function months(db,month){
  const r=await db.prepare(`SELECT m.account_id,a.client_id,c.name AS client_name,a.username,m.period,m.period_end,
    m.followers_current,m.media_count_current,m.views,m.reach,m.interactions,m.checks_json,m.collected_at
    FROM social_meta_months m
    JOIN social_meta_accounts a ON a.id=m.account_id JOIN clients c ON c.id=a.client_id
    WHERE m.period=? ORDER BY c.name`).bind(month).all();
  return (r.results||[]).map(row=>{let checks={};try{checks=JSON.parse(row.checks_json||'{}')}catch{};delete row.checks_json;return {...row,checks}});
}
async function discover(token){
  if(!token)return {ok:false,error:'Token Meta assente. Configura META_IG_ACCESS_TOKEN come secret Production.'};
  let path='me/accounts',params={fields:'id,name,instagram_business_account{id,username}',limit:'100'};
  const entries=[],seen=new Set();
  for(let page=0;page<3;page++){
    const result=await meta(path,params,token);
    if(!result.ok)return {ok:false,error:'Meta non autorizza la lettura delle Pagine (verificare token e permessi).',status:result.code};
    for(const p of result.data.data||[]){
      const ig=p.instagram_business_account;
      if(ig&&validId(ig.id)&&validId(p.id)&&!seen.has(String(ig.id))){
        seen.add(String(ig.id));entries.push({ig_user_id:String(ig.id),fb_page_id:String(p.id),
          page_name:String(p.name||'').slice(0,100),username:String(ig.username||'').slice(0,100)});
      }
    }
    // Meta pagination links may contain access tokens: never forward them to browser or follow an arbitrary URL.
    // A single 100-item page is enough for the initial small-agency rollout.
    break;
  }
  return {ok:true,accounts:entries};
}
function normalizeName(v){return String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')}
const knownAliases={
  kineosal:'kineosalmesoraca',
  maurizioboutique:'maurizioboutique',
  vesuviana:'lavesuvianade',
  brunoschipanisnc:'schipaniauto',
  ristoranteoasi:'oasiristorante'
};
async function suggestions(db,token){
  const available=await discover(token);
  if(!available.ok)return available;
  const clients=await db.prepare("SELECT id,name FROM clients WHERE status='Attivo' ORDER BY name").all();
  const linked=await accounts(db),used=new Set(linked.map(x=>String(x.ig_user_id)));
  const existing=new Set(linked.map(x=>Number(x.client_id)));
  const proposals=[];
  for(const c of clients.results||[]){
    if(existing.has(Number(c.id)))continue;
    const key=normalizeName(c.name);
    const target=knownAliases[key]||key;
    const matches=available.accounts.filter(a=>normalizeName(a.username)===target&&!used.has(a.ig_user_id));
    if(matches.length===1)proposals.push({client_id:c.id,client_name:c.name,...matches[0]});
  }
  return {ok:true,suggestions:proposals};
}
function numberOrNull(v){return typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null}
function extract(data,name){
  const row=(data?.data||[]).find(x=>x.name===name);
  return numberOrNull(row?.total_value?.value);
}
async function collectOne(db,account,token,month){
  const {since,until}=monthWindow(month);
  if(until<=since)return {client_id:account.client_id,client_name:account.client_name,status:'period_incomplete'};
  const [profile,insights]=await Promise.all([
    meta(encodeURIComponent(account.ig_user_id),{fields:'id,username,followers_count,media_count'},token),
    meta(encodeURIComponent(account.ig_user_id)+'/insights',{
      metric:'reach,views,total_interactions',period:'day',metric_type:'total_value',since,until},token)
  ]);
  if(!profile.ok||String(profile.data?.id)!==String(account.ig_user_id))
    return {client_id:account.client_id,client_name:account.client_name,status:profile.code||'account_unavailable'};
  if(!insights.ok)return {client_id:account.client_id,client_name:account.client_name,status:insights.code};
  const data={
    followers:numberOrNull(profile.data.followers_count),
    media:numberOrNull(profile.data.media_count),
    views:extract(insights.data,'views'),reach:extract(insights.data,'reach'),
    interactions:extract(insights.data,'total_interactions')
  };
  const checks={views:data.views!==null?'ok':'not_available',reach:data.reach!==null?'ok':'not_available',
    interactions:data.interactions!==null?'ok':'not_available'};
  if(Object.values(checks).every(x=>x!=='ok'))
    return {client_id:account.client_id,client_name:account.client_name,status:'metrics_unavailable'};
  await db.prepare(`INSERT INTO social_meta_months(
    account_id,period,period_end,followers_current,media_count_current,views,reach,interactions,checks_json,collected_at)
    VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(account_id,period) DO UPDATE SET
    period_end=excluded.period_end,followers_current=excluded.followers_current,
    media_count_current=excluded.media_count_current,views=excluded.views,reach=excluded.reach,
    interactions=excluded.interactions,checks_json=excluded.checks_json,collected_at=CURRENT_TIMESTAMP`)
    .bind(account.id,month,until,data.followers,data.media,data.views,data.reach,data.interactions,JSON.stringify(checks)).run();
  return {client_id:account.client_id,client_name:account.client_name,status:'saved',checks};
}
export async function onRequestGet({request,env}){
  const url=new URL(request.url),action=url.searchParams.get('action')||'status',month=url.searchParams.get('month')||new Date().toISOString().slice(0,7);
  if(action==='discover'){
    const found=await discover(tokenFrom(env));
    return response(found,found.ok?200:502);
  }
  if(action==='suggest'){
    if(!env.DB||!await tables(env.DB))return response({error:'Archivio Meta non inizializzato'},409);
    const candidates=await suggestions(env.DB,tokenFrom(env));
    return response(candidates,candidates.ok?200:502);
  }
  if(action!=='status')return response({error:'Azione sconosciuta'},400);
  if(!validMonth(month))return response({error:'Mese non valido'},400);
  if(!env.DB)return response({error:'Binding DB mancante'},503);
  if(!await tables(env.DB))return response({setup_required:true,configured:Boolean(tokenFrom(env)),accounts:[],months:[],period:month});
  const [linked,snapshots]=await Promise.all([accounts(env.DB),months(env.DB,month)]);
  return response({setup_required:false,configured:Boolean(tokenFrom(env)),accounts:linked,months:snapshots,period:month});
}
export async function onRequestPost({request,env}){
  if(!env.DB)return response({error:'Binding DB mancante'},503);
  let body;try{body=await request.json()}catch{return response({error:'JSON non valido'},400)}
  const action=String(body?.action||'');
  if(action==='setup'){
    // DDL only, explicit admin click; existing EFFE tables and reports remain untouched.
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS social_meta_accounts(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
      ig_user_id TEXT NOT NULL UNIQUE,fb_page_id TEXT NOT NULL,username TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS social_meta_months(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES social_meta_accounts(id) ON DELETE CASCADE,
      period TEXT NOT NULL,period_end TEXT NOT NULL,
      followers_current INTEGER,media_count_current INTEGER,views INTEGER,reach INTEGER,interactions INTEGER,
      checks_json TEXT,collected_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id,period))`).run();
    return response({ok:true});
  }
  if(!await tables(env.DB))return response({error:'Archivio Meta non inizializzato'},409);
  if(action==='auto_link'){
    if(body.confirm!==true)return response({error:'Conferma esplicita richiesta'},400);
    const proposal=await suggestions(env.DB,tokenFrom(env));
    if(!proposal.ok)return response({error:proposal.error},502);
    const selected=new Set((Array.isArray(body.client_ids)?body.client_ids:[]).map(Number));
    const candidates=proposal.suggestions.filter(x=>selected.has(Number(x.client_id)));
    if(!candidates.length)return response({ok:true,linked:[]});
    const queries=candidates.map(a=>env.DB.prepare(
      "INSERT INTO social_meta_accounts(client_id,ig_user_id,fb_page_id,username) VALUES(?,?,?,?)"
    ).bind(a.client_id,a.ig_user_id,a.fb_page_id,a.username));
    try{await env.DB.batch(queries)}catch(_){return response({error:'Associazione non riuscita: ricontrollare i collegamenti attivi'},409)}
    return response({ok:true,linked:candidates.map(x=>({client_id:x.client_id,username:x.username}))});
  }
  if(action==='link'){
    const clientId=Number(body.client_id),ig=String(body.ig_user_id||''),page=String(body.fb_page_id||'');
    if(!Number.isSafeInteger(clientId)||clientId<1||!validId(ig)||!validId(page))
      return response({error:'Cliente o account non valido'},400);
    const client=await env.DB.prepare("SELECT id FROM clients WHERE id=? AND status='Attivo'").bind(clientId).first();
    if(!client)return response({error:'Cliente attivo inesistente'},404);
    const available=await discover(tokenFrom(env));
    if(!available.ok)return response({error:available.error},502);
    const candidate=available.accounts.find(x=>x.ig_user_id===ig&&x.fb_page_id===page);
    if(!candidate)return response({error:'Account non presente fra quelli autorizzati da Meta'},403);
    const belongs=await env.DB.prepare('SELECT client_id FROM social_meta_accounts WHERE ig_user_id=?').bind(ig).first();
    if(belongs&&Number(belongs.client_id)!==clientId)return response({error:'Account già associato a un altro cliente'},409);
    const current=await env.DB.prepare('SELECT ig_user_id FROM social_meta_accounts WHERE client_id=?').bind(clientId).first();
    if(current&&String(current.ig_user_id)!==ig)return response({error:'Cliente già collegato. Evitare di sovrascrivere lo storico: contattare l’amministratore.'},409);
    await env.DB.prepare(`INSERT INTO social_meta_accounts(client_id,ig_user_id,fb_page_id,username)
      VALUES(?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET
      ig_user_id=excluded.ig_user_id,fb_page_id=excluded.fb_page_id,username=excluded.username,updated_at=CURRENT_TIMESTAMP`)
      .bind(clientId,ig,page,candidate.username).run();
    return response({ok:true,client_id:clientId,username:candidate.username});
  }
  if(action==='sync'){
    const month=String(body.month||new Date().toISOString().slice(0,7));
    if(!validMonth(month)||month>new Date().toISOString().slice(0,7))
      return response({error:'Mese non valido'},400);
    const linked=await accounts(env.DB),ids=Array.isArray(body.client_ids)?new Set(body.client_ids.map(Number)):null;
    const selected=linked.filter(x=>!ids||ids.has(Number(x.client_id)));
    if(selected.length>15)return response({error:'Massimo 15 account per operazione'},400);
    const token=tokenFrom(env);if(!token)return response({error:'Token Meta non configurato'},503);
    const results=[];
    // Low concurrency so a single request stays below Cloudflare subrequest and Meta rate limits.
    for(let i=0;i<selected.length;i+=3){
      const chunk=await Promise.all(selected.slice(i,i+3).map(async a=>{
        try{return await collectOne(env.DB,a,token,month)}
        catch(_){return {client_id:a.client_id,client_name:a.client_name,status:'database_error'}}
      }));
      results.push(...chunk);
    }
    return response({ok:true,month,results,updated:results.filter(x=>x.status==='saved').length});
  }
  return response({error:'Azione sconosciuta'},400);
}
export async function onRequest(){return response({error:'Metodo non consentito'},405)}
