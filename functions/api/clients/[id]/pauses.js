// Client service pauses. Only monthly automatic retainers are suppressed;
// paid/partially paid and manual financial documents are never silently altered.
const out=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}});
const goodMonth=v=>/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v||''));
const currentMonth=()=>new Date().toISOString().slice(0,7);
const months=(a,b)=>{const result=[];let [y,m]=a.split('-').map(Number),n=0;while(`${y}-${String(m).padStart(2,'0')}`<=b&&n++<36){result.push(`${y}-${String(m).padStart(2,'0')}`);if(++m>12){m=1;y++}}return result};
async function exists(db){const t=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='client_billing_pauses'").first();return Boolean(t)}
function pathId(params){const raw=Array.isArray(params.id)?params.id[0]:params.id;const v=Number(raw);return Number.isSafeInteger(v)&&v>0?v:null}
async function list(db,id){const r=await db.prepare('SELECT id,start_month,end_month,reason,created_at FROM client_billing_pauses WHERE client_id=? ORDER BY start_month DESC,id DESC').bind(id).all();return r.results||[]}
async function guard(db,id,range){
  const marks=range.map(()=>'?').join(',');
  const paymentRows=(await db.prepare(`SELECT p.id,p.period,p.due_date,p.status,p.auto_generated,p.type,
    COALESCE((SELECT SUM(amount) FROM payment_receipts WHERE payment_id=p.id),0)+
    COALESCE((SELECT SUM(amount) FROM transactions WHERE payment_id=p.id),0) AS received
    FROM payments p WHERE p.client_id=? AND p.type='Canone' AND p.status<>'Annullato'
    AND COALESCE(p.period,substr(p.due_date,1,7)) IN (${marks})`).bind(id,...range).all()).results||[];
  const blocked=paymentRows.filter(p=>Number(p.received)>0||p.status==='Pagato'||p.status==='Parzialmente pagato'||Number(p.auto_generated)!==1);
  const invoices=(await db.prepare(`SELECT id FROM invoices WHERE client_id=? AND substr(COALESCE(issue_date,due_date,''),1,7) IN (${marks})
    AND COALESCE(status,'') NOT IN ('Annullata','Bozza') LIMIT 1`).bind(id,...range).all()).results||[];
  return {blocked,invoices,paymentRows};
}
export async function onRequestGet({env,params}){
  if(!env.DB)return out({error:'Database non collegato'},503);
  const id=pathId(params);if(!id)return out({error:'Cliente non valido'},400);
  const present=await exists(env.DB);
  if(!present)return out({initialized:false,pauses:[],current_month:currentMonth()});
  return out({initialized:true,pauses:await list(env.DB,id),current_month:currentMonth()});
}
export async function onRequestPost({env,params,request}){
  const db=env.DB;if(!db)return out({error:'Database non collegato'},503);
  const id=pathId(params);if(!id)return out({error:'Cliente non valido'},400);
  const client=await db.prepare("SELECT id,status FROM clients WHERE id=?").bind(id).first();
  if(!client)return out({error:'Cliente inesistente'},404);
  let body;try{body=await request.json()}catch{return out({error:'Dati non validi'},400)}
  if(body.action==='setup'){
    await db.prepare(`CREATE TABLE IF NOT EXISTS client_billing_pauses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      start_month TEXT NOT NULL,end_month TEXT NOT NULL,reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(start_month<=end_month))`).run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_client_billing_pauses_month ON client_billing_pauses(client_id,start_month,end_month)').run();
    return out({ok:true,initialized:true});
  }
  if(body.action==='resume'){
    if(!await exists(db))return out({error:'Archivio sospensioni non inizializzato'},409);
    const pauseId=Number(body.pause_id);
    if(!Number.isSafeInteger(pauseId)||pauseId<1)return out({error:'Sospensione non valida'},400);
    const pause=await db.prepare('SELECT * FROM client_billing_pauses WHERE client_id=? AND id=?').bind(id,pauseId).first();
    if(!pause)return out({error:'Sospensione inesistente'},404);
    // Resuming only future/current months; already elapsed pauses are retained for the audit trail.
    if(pause.end_month<currentMonth())return out({error:'Non puoi cancellare una sospensione storica già conclusa'},409);
    await db.prepare('DELETE FROM client_billing_pauses WHERE client_id=? AND id=?').bind(id,pauseId).run();
    return out({ok:true,removed:pauseId,pauses:await list(db,id)});
  }
  if(body.action!=='pause')return out({error:'Operazione non valida'},400);
  if(!await exists(db))return out({error:'Archivio sospensioni non inizializzato'},409);
  if(client.status!=='Attivo')return out({error:'Il cliente deve essere attivo'},409);
  const start=String(body.start_month||''),end=String(body.end_month||'');
  if(!goodMonth(start)||!goodMonth(end)||start>end||start<currentMonth())return out({error:'Seleziona mesi validi: da quello corrente in avanti'},400);
  const range=months(start,end);
  if(!range.length||range.length>24||range.at(-1)!==end)return out({error:'Puoi sospendere al massimo 24 mesi consecutivi'},400);
  const conflict=await db.prepare('SELECT id FROM client_billing_pauses WHERE client_id=? AND start_month<=? AND end_month>=? LIMIT 1').bind(id,end,start).first();
  if(conflict)return out({error:'Esiste già una sospensione sovrapposta'},409);
  const {blocked,invoices,paymentRows}=await guard(db,id,range);
  if(blocked.length)return out({error:'Esistono rate già incassate, parzialmente incassate o create manualmente in questo periodo. Verifica prima i pagamenti.'},409);
  if(invoices.length)return out({error:'Esistono fatture emesse per uno dei mesi selezionati. Non posso sospendere automaticamente un importo già fatturato.'},409);
  const reason=String(body.reason||'').trim().slice(0,200)||null;
  const openAuto=paymentRows.filter(p=>Number(p.auto_generated)===1&&!['Pagato','Parzialmente pagato'].includes(p.status));
  const statements=[db.prepare('INSERT INTO client_billing_pauses(client_id,start_month,end_month,reason) VALUES(?,?,?,?)').bind(id,start,end,reason)];
  for(const p of openAuto)statements.push(db.prepare('DELETE FROM payments WHERE id=? AND auto_generated=1').bind(p.id));
  await db.batch(statements);
  return out({ok:true,excluded_months:range.length,removed_open_installments:openAuto.length,pauses:await list(db,id)});
}
export async function onRequest(){return out({error:'Metodo non consentito'},405)}
