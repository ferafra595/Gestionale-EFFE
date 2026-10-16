async function paidSoFar(db,id){
  const [r,t]=await db.batch([
    db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payment_receipts WHERE payment_id=?`).bind(id),
    db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE payment_id=?`).bind(id)
  ]);
  return Number(r.results?.[0]?.v||0)+Number(t.results?.[0]?.v||0);
}

export async function onRequestPost({request,env}){
  const db=env.DB;if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  const {id}=await request.json().catch(()=>({}));if(!id)return Response.json({error:'Pagamento non valido'},{status:400});
  const p=await db.prepare(`SELECT p.*,c.name client_name,c.status client_status FROM payments p LEFT JOIN clients c ON c.id=p.client_id WHERE p.id=?`).bind(id).first();
  if(!p)return Response.json({error:'Pagamento non trovato'},{status:404});
  if(p.client_id && p.client_status!=='Attivo')return Response.json({error:'Il cliente non è attivo. Riattivalo prima di confermare un incasso.'},{status:400});

  const total=Math.max(0,Number(p.amount||0)),already=await paidSoFar(db,id),residual=Math.max(0,total-already);
  if(residual<=0){
    await db.prepare(`UPDATE payments SET status='Pagato',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
    return Response.json({ok:true,payment_id:id,status:'Pagato',amount:0,residual:0});
  }

  const today=new Date().toISOString().slice(0,10),effectiveDate=Number(p.auto_generated||0)===1&&p.due_date?p.due_date:(p.paid_date||p.due_date||today);
  const description=`${already>0?'Saldo':'Incasso'} ${p.client_name||'cliente'}${p.period?` - ${p.period}`:''}`;

  if(already<=0){
    // Compatibilità con il flusso storico: un incasso completo resta collegato direttamente al pagamento.
    const tx=await db.prepare(`SELECT id FROM transactions WHERE payment_id=? LIMIT 1`).bind(id).first();
    if(tx)await db.prepare(`UPDATE transactions SET client_id=?,direction='Entrata',date=?,category='Canone cliente',amount=?,description=?,notes='Generato automaticamente da pagamento confermato',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(p.client_id,effectiveDate,residual,description,tx.id).run();
    else await db.prepare(`INSERT INTO transactions(client_id,payment_id,direction,date,category,amount,description,notes) VALUES(?,?,?,?,?,?,?,?)`).bind(p.client_id,id,'Entrata',effectiveDate,'Canone cliente',residual,description,'Generato automaticamente da pagamento confermato').run();
  }else{
    const rr=await db.prepare(`INSERT INTO payment_receipts(payment_id,amount,receipt_date,method,notes,kind) VALUES(?,?,?,?,?,?)`).bind(id,residual,effectiveDate,p.method||null,'Saldo registrato con Conferma incasso','Saldo').run();
    const receiptId=rr.meta.last_row_id;
    await db.prepare(`INSERT INTO transactions(client_id,payment_receipt_id,direction,date,category,amount,description,notes) VALUES(?,?,?,?,?,?,?,?)`).bind(p.client_id,receiptId,'Entrata',effectiveDate,'Canone cliente',residual,description,'Saldo automatico del pagamento').run();
  }
  await db.prepare(`UPDATE payments SET status='Pagato',paid_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(effectiveDate,id).run();
  return Response.json({ok:true,payment_id:id,status:'Pagato',amount:residual,residual:0,effective_date:effectiveDate});
}
