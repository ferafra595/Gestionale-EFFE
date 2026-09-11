export async function onRequestPost({request,env}){
  const db=env.DB;if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  const {id}=await request.json().catch(()=>({}));if(!id)return Response.json({error:'Pagamento non valido'},{status:400});
  const p=await db.prepare(`SELECT p.*,c.name client_name FROM payments p LEFT JOIN clients c ON c.id=p.client_id WHERE p.id=?`).bind(id).first();
  if(!p)return Response.json({error:'Pagamento non trovato'},{status:404});
  const today=new Date().toISOString().slice(0,10);
  if(p.status!=='Pagato')await db.prepare(`UPDATE payments SET status='Pagato',paid_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(today,id).run();
  const tx=await db.prepare(`SELECT id FROM transactions WHERE payment_id=? LIMIT 1`).bind(id).first();
  if(!tx)await db.prepare(`INSERT INTO transactions(client_id,payment_id,direction,date,category,amount,description,notes) VALUES(?,?,?,?,?,?,?,?)`).bind(p.client_id,id,'Entrata',today,'Canone cliente',Number(p.amount||0),`Incasso ${p.client_name||'cliente'}${p.period?` - ${p.period}`:''}`,'Generato automaticamente da pagamento confermato').run();
  return Response.json({ok:true,payment_id:id,status:'Pagato'});
}
