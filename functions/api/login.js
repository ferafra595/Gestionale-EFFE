export async function onRequestPost({request,env}){
  const {password=''}=await request.json();
  if(!env.ADMIN_PASSWORD) return Response.json({error:'Imposta ADMIN_PASSWORD nelle variabili Cloudflare.'},{status:500});
  if(password!==env.ADMIN_PASSWORD) return Response.json({error:'Password non corretta'},{status:401});
  const exp=String(Date.now()+1000*60*60*24*7); const sig=await sign(exp,env.SESSION_SECRET||'change-me');
  return new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json','Set-Cookie':`effe_session=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`}})
}
async function sign(data,secret){const enc=new TextEncoder();const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const buf=await crypto.subtle.sign('HMAC',key,enc.encode(data));return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_')}
