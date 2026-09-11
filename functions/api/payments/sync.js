function ym(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function lastDay(y,m){return new Date(y,m,0).getDate()}
function dueDateFor(period,day){const [y,m]=period.split('-').map(Number);const d=Math.min(Math.max(Number(day||30),1),lastDay(y,m));return `${period}-${String(d).padStart(2,'0')}`}
export async function onRequestPost({env}){
  const db=env.DB;if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  const period=ym(),today=new Date().toISOString().slice(0,10),first=`${period}-01`;
  const cols=(await db.prepare('PRAGMA table_info(clients)').all()).results||[];
  const hasAuto=cols.some(x=>x.name==='auto_billing'),hasDay=cols.some(x=>x.name==='billing_day');
  if(!hasAuto||!hasDay)return Response.json({error:'Migrazione pagamenti automatici non eseguita'},{status:400});
  const clients=(await db.prepare(`SELECT id,name,monthly_value,start_date,end_date,auto_billing,billing_day FROM clients WHERE status='Attivo' AND COALESCE(monthly_value,0)>0 AND COALESCE(auto_billing,1)=1`).all()).results||[];
  let created=0;
  for(const c of clients){
    if(c.start_date && c.start_date>`${period}-31`)continue;
    if(c.end_date && c.end_date<first)continue;
    const due=dueDateFor(period,c.billing_day||30);
    const existing=await db.prepare(`SELECT id FROM payments WHERE client_id=? AND period=? AND type='Canone' AND auto_generated=1 LIMIT 1`).bind(c.id,period).first();
    if(!existing){await db.prepare(`INSERT INTO payments(client_id,type,amount,due_date,status,reference,period,auto_generated,notes) VALUES(?,?,?,?,?,?,?,?,?)`).bind(c.id,'Canone',Number(c.monthly_value||0),due,'Da pagare',`AUTO-${period}`,period,1,'Canone mensile generato automaticamente da EFFE OS').run();created++}
  }
  await db.prepare(`UPDATE payments SET status='Scaduto' WHERE status='Da pagare' AND due_date IS NOT NULL AND due_date<?`).bind(today).run();
  // Allinea anche i vecchi pagamenti già segnati come pagati con Entrate/Uscite.
  const paid=(await db.prepare(`SELECT p.id,p.client_id,p.amount,p.paid_date,p.due_date,p.period,c.name client_name FROM payments p LEFT JOIN clients c ON c.id=p.client_id WHERE p.status='Pagato'`).all()).results||[];
  for(const p of paid){
    const exists=await db.prepare(`SELECT id FROM transactions WHERE payment_id=? LIMIT 1`).bind(p.id).first();
    if(!exists){const dt=p.paid_date||p.due_date||today;await db.prepare(`INSERT INTO transactions(client_id,payment_id,direction,date,category,amount,description,notes) VALUES(?,?,?,?,?,?,?,?)`).bind(p.client_id,p.id,'Entrata',dt,'Canone cliente',Number(p.amount||0),`Incasso ${p.client_name||'cliente'}${p.period?` - ${p.period}`:''}`,'Generato automaticamente da pagamento confermato').run()}
  }
  return Response.json({ok:true,period,created});
}
