// EFFE OS — K.I.R.A. read-only operational briefing.
// Protected by a dedicated server-side secret KIRA_READ_TOKEN.
const respond=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"private, no-store, max-age=0",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Vary":"Authorization"
}});
async function secureEquals(actual,expected){
  if(!actual||!expected||actual.length>512||expected.length<32)return false;
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([crypto.subtle.digest("SHA-256",enc.encode(actual)),crypto.subtle.digest("SHA-256",enc.encode(expected))]);
  const aa=new Uint8Array(a),bb=new Uint8Array(b);let mismatch=0;
  for(let i=0;i<aa.length;i++)mismatch|=aa[i]^bb[i];
  return mismatch===0;
}
export async function onRequestGet({request,env}){
  if(!env.DB||!env.KIRA_READ_TOKEN||String(env.KIRA_READ_TOKEN).length<32)
    return respond({error:"Servizio non configurato"},503);
  const auth=request.headers.get("Authorization")||"";
  const token=/^Bearer ([A-Za-z0-9_-]{32,512})$/.exec(auth)?.[1];
  if(!(await secureEquals(token,String(env.KIRA_READ_TOKEN))))return respond({error:"Non autorizzato"},401);
  try{
    const today=new Date().toISOString().slice(0,10);
    const pausedTable=Boolean(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='client_billing_pauses'").first());
    const activeMonth=today.slice(0,7);
    const mrrPredicate=pausedTable?" AND NOT EXISTS (SELECT 1 FROM client_billing_pauses p WHERE p.client_id=clients.id AND ? BETWEEN p.start_month AND p.end_month)":'';
    const [clients,payments,tasks,contents,packages,leads]=await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(ROUND(SUM(CASE WHEN "+(pausedTable?"NOT EXISTS (SELECT 1 FROM client_billing_pauses bp WHERE bp.client_id=clients.id AND ? BETWEEN bp.start_month AND bp.end_month)":"1=1")+" THEN COALESCE(monthly_value,0) ELSE 0 END),2),0) AS monthly_value FROM clients WHERE status='Attivo'").bind(...(pausedTable?[activeMonth]:[])),
      env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(ROUND(SUM(p.amount),2),0) AS nominal_amount FROM payments p JOIN clients c ON c.id=p.client_id WHERE c.status='Attivo' AND p.status IN ('Da pagare','Scaduto','Parzialmente pagato') AND p.due_date<?").bind(today),
      env.DB.prepare("SELECT t.id,t.title,t.status,t.priority,t.due_date,c.name AS client_name FROM tasks t LEFT JOIN clients c ON c.id=t.client_id WHERE COALESCE(t.status,'') NOT IN ('Completato','Annullato','Archiviato') ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,t.due_date ASC,t.id DESC LIMIT 40"),
      env.DB.prepare("SELECT x.id,x.title,x.type,x.status,x.date,c.name AS client_name FROM content x LEFT JOIN clients c ON c.id=x.client_id WHERE COALESCE(x.status,'') NOT IN ('Pubblicato','Completato','Annullato') ORDER BY CASE WHEN x.date IS NULL THEN 1 ELSE 0 END,x.date ASC,x.id DESC LIMIT 40"),
      env.DB.prepare("SELECT name,package_end_date AS date FROM clients WHERE status='Attivo' AND package_end_date BETWEEN ? AND date(?,'+30 days') ORDER BY package_end_date LIMIT 20").bind(today,today),
      env.DB.prepare("SELECT COUNT(*) AS count FROM leads WHERE COALESCE(stage,'') NOT IN ('Cliente','Perso') AND next_contact IS NOT NULL AND next_contact<=?").bind(today)
    ]);
    return respond({
      as_of:today,
      clients:clients.results?.[0]||{count:0,monthly_value:0},
      overdue_payments:payments.results?.[0]||{count:0,nominal_amount:0},
      open_tasks:tasks.results||[],
      pending_content:contents.results||[],
      packages_ending_30d:packages.results||[],
      leads_to_contact:Number(leads.results?.[0]?.count||0),
      limitations:["Riepilogo sintetico, massimo 40 task e 40 contenuti","Importi scaduti nominali, non saldo residuo","MRR netto delle sospensioni del mese corrente","Date basate su UTC"]
    });
  }catch(_){return respond({error:"Impossibile generare il briefing"},500);}
}
export async function onRequest(){return respond({error:"Metodo non consentito"},405);}
