export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith('/api/') || ['/api/login','/api/session'].includes(url.pathname)) return context.next();
  const cookie = context.request.headers.get('Cookie') || '';
  const token = cookie.match(/effe_session=([^;]+)/)?.[1];
  if (!token || !(await verifyToken(token, context.env.SESSION_SECRET || 'change-me'))) return Response.json({error:'Non autorizzato'},{status:401});
  return context.next();
}
async function verifyToken(token, secret){try{const [exp,sig]=token.split('.');if(Number(exp)<Date.now())return false;const enc=new TextEncoder();const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const buf=await crypto.subtle.sign('HMAC',key,enc.encode(exp));const expected=btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');return expected===sig}catch{return false}}
