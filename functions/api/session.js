export async function onRequest({request,env}){
  const cookie=request.headers.get('Cookie')||'';
  const token=cookie.match(/effe_session=([^;]+)/)?.[1];
  const authenticated=token ? await verifyToken(token,env.SESSION_SECRET||'change-me') : false;
  return Response.json({authenticated});
}
async function verifyToken(token,secret){try{const [exp,sig]=token.split('.');if(!exp||!sig||Number(exp)<Date.now())return false;const enc=new TextEncoder();const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const buf=await crypto.subtle.sign('HMAC',key,enc.encode(exp));const expected=btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');return expected===sig}catch{return false}}
