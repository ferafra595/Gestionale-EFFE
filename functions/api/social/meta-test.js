// EFFE OS | Meta pilot (read-only) for a single authorised professional account.
// The existing /api/* middleware requires an EFFE admin session.
// No automatic publishing, token persistence in D1, or profile modification.
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  'content-type':'application/json; charset=utf-8',
  'cache-control':'private, no-store, max-age=0',
  'x-content-type-options':'nosniff'
}});
const digits=s=>/^\d{5,30}$/.test(String(s||''));
export async function onRequestGet({env}){
  const id=String(env.META_IG_USER_ID||'').trim();
  const token=String(env.META_IG_ACCESS_TOKEN||'').trim();
  if(!id||!token)return reply({connected:false,status:'not_configured',message:'Account Meta non collegato: configurare META_IG_USER_ID e META_IG_ACCESS_TOKEN come segreti in produzione.'});
  if(!digits(id))return reply({connected:false,status:'invalid_configuration',message:'Identificativo Instagram non valido.'},400);
  // Explicitly pin the version; require a controlled code update to move API versions.
  const url=new URL('https://graph.facebook.com/v27.0/'+encodeURIComponent(id));
  url.searchParams.set('fields','id,username,followers_count,media_count');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),7000);
  try{
    const response=await fetch(url,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:controller.signal,redirect:'manual'});
    if(response.status>=300&&response.status<400)return reply({connected:false,status:'meta_redirect',message:'Meta ha richiesto un reindirizzamento inatteso. Nessuna credenziale è stata inoltrata.'},502);
    const body=await response.json().catch(()=>({}));
    if(!response.ok){
      // Do not return Meta's raw errors (some include private account details).
      return reply({connected:false,status:'meta_error',http_status:response.status,meta_error_code:Number(body?.error?.code)||null,message:'Meta non ha autorizzato la lettura. Controllare account, token e permessi.'},502);
    }
    if(String(body.id)!==id)return reply({connected:false,status:'account_mismatch',message:'ID account inatteso nella risposta Meta.'},502);
    return reply({
      connected:true,status:'ok',account:{id:body.id,username:body.username||null,
        followers_count:Number.isFinite(Number(body.followers_count))?Number(body.followers_count):null,
        media_count:Number.isFinite(Number(body.media_count))?Number(body.media_count):null},
      retrieved_at:new Date().toISOString(),
      limitations:['Test profilo: NON è un report mensile','Per insight reach, views e interazioni serve una seconda verifica di permessi e metriche','Dati Meta non salvati in EFFE']
    });
  }catch(_){return reply({connected:false,status:'request_failed',message:'Impossibile contattare Meta in questo momento.'},502);}
  finally{clearTimeout(timeout);}
}
export async function onRequest(){return reply({error:'Metodo non consentito'},405);}
