export async function onRequestPost({request,env}){
  const db=env.DB;if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  const {id}=await request.json().catch(()=>({}));if(!id)return Response.json({error:'Pagamento non valido'},{status:400});
  const p=await db.prepare(`SELECT p.*,c.name client_name,c.status client_status FROM payments p LEFT JOIN clients c ON c.id=p.client_id WHERE p.id=?`).bind(id).first();
  if(!p)return Response.json({error:'Pagamento non trovato'},{status:404});
  if(p.client_id && p.client_status!=='Attivo')return Response.json({error:'Il cliente non è attivo. Riattivalo prima di confermare un incasso.'},{status:400});
  const today=new Date().toISOString().slice(0,10),effectiveDate=Number(p.auto_generated||0)===1&&p.due_date?p.due_date:(p.paid_date||p.due_date||today);
  if(p.status!=='Pagato')await db.prepare(`UPDATE payments SET status='Pagato',paid_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(effectiveDate,id).run();
  const tx=await db.prepare(`SELECT id FROM transactions WHERE payment_id=? LIMIT 1`).bind(id).first(),description=`Incasso ${p.client_name||'cliente'}${p.period?` - ${p.period}`:''}`;
  if(tx)await db.prepare(`UPDATE transactions SET client_id=?,direction='Entrata',date=?,category='Canone cliente',amount=?,description=?,notes='Generato automaticamente da pagamento confermato',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(p.client_id,effectiveDate,Number(p.amount||0),description,tx.id).run();
  else await db.prepare(`INSERT INTO transactions(client_id,payment_id,direction,date,category,amount,description,notes) VALUES(?,?,?,?,?,?,?,?)`).bind(p.client_id,id,'Entrata',effectiveDate,'Canone cliente',Number(p.amount||0),description,'Generato automaticamente da pagamento confermato').run();
  return Response.json({ok:true,payment_id:id,status:'Pagato',effective_date:effectiveDate});
}
