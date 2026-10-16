async function paidSoFar(db,id){
  const [r,t]=await db.batch([
    db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payment_receipts WHERE payment_id=?`).bind(id),
    db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE payment_id=?`).bind(id)
  ]);
  return Number(r.results?.[0]?.v||0)+Number(t.results?.[0]?.v||0);
}

export async function onRequestPost({request,env}){
  const db=env.DB;if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  const body=await request.json().catch(()=>({})),id=Number(body.id||0),amount=Number(body.amount||0);
  if(!id||!Number.isFinite(amount)||amount<=0)return Response.json({error:'Inserisci un importo acconto valido.'},{status:400});
  const p=await db.prepare(`SELECT p.*,c.name client_name,c.status client_status FROM payments p LEFT JOIN clients c ON c.id=p.client_id WHERE p.id=?`).bind(id).first();
  if(!p)return Response.json({error:'Pagamento non trovato.'},{status:404});
  if(p.client_id&&p.client_status!=='Attivo')return Response.json({error:'Il cliente non è attivo.'},{status:400});
  if(String(p.status||'')==='Annullato')return Response.json({error:'Il pagamento è annullato.'},{status:400});
  const total=Math.max(0,Number(p.amount||0)),already=await paidSoFar(db,id),residual=Math.max(0,total-already);
  if(residual<=0)return Response.json({error:'Questo pagamento risulta già saldato.'},{status:400});
  if(amount>residual+0.0001)return Response.json({error:`L'acconto non può superare il residuo di ${residual.toFixed(2)} €.`},{status:400});

  const receiptDate=String(body.date||new Date().toISOString().slice(0,10)),method=String(body.method||'').trim()||null,notes=String(body.notes||'').trim()||null;
  const closes=Math.abs(amount-residual)<0.0001,kind=closes?'Saldo':'Acconto';
  const rr=await db.prepare(`INSERT INTO payment_receipts(payment_id,amount,receipt_date,method,notes,kind) VALUES(?,?,?,?,?,?)`).bind(id,amount,receiptDate,method,notes,kind).run();
  const receiptId=rr.meta.last_row_id,description=`${kind} ${p.client_name||'cliente'}${p.period?` - ${p.period}`:''}`;
  await db.prepare(`INSERT INTO transactions(client_id,payment_receipt_id,direction,date,category,amount,description,notes) VALUES(?,?,?,?,?,?,?,?)`).bind(p.client_id,receiptId,'Entrata',receiptDate,'Canone cliente',amount,description,notes||`Registrato dalla sezione Pagamenti`).run();
  const newResidual=Math.max(0,residual-amount),status=closes?'Pagato':'Parzialmente pagato';
  await db.prepare(`UPDATE payments SET status=?,paid_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(status,closes?receiptDate:null,id).run();
  return Response.json({ok:true,payment_id:id,receipt_id:receiptId,status,paid_amount:already+amount,residual_amount:newResidual});
}
