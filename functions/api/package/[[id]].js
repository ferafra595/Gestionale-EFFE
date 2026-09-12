function cleanDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):null}
export async function onRequestPut({request,env,params}){
  const db=env.DB,rawId=Array.isArray(params.id)?params.id[0]:params.id,id=Number(rawId);
  if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  if(!id)return Response.json({error:'Cliente non valido'},{status:400});
  try{
    const data=await request.json();
    const start=cleanDate(data.package_start_date),end=cleanDate(data.package_end_date);
    if(!start)return Response.json({error:'Inserisci la data di inizio pacchetto'},{status:400});
    if(end&&end<start)return Response.json({error:'La data fine non può essere precedente alla data inizio'},{status:400});
    const monthly=Math.max(0,Number(data.monthly_value||0));
    const billing=Math.min(31,Math.max(1,Number(data.billing_day||30)));
    const auto=Number(data.auto_billing)===0?0:1;
    await db.prepare(`UPDATE clients SET package_start_date=?,package_end_date=?,monthly_value=?,billing_day=?,auto_billing=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(start,end,monthly,billing,auto,id).run();
    const fresh=await db.prepare(`SELECT id,name,package_start_date,package_end_date,monthly_value,billing_day,auto_billing FROM clients WHERE id=?`).bind(id).first();
    return Response.json({ok:true,client:fresh});
  }catch(e){
    return Response.json({error:`Salvataggio pacchetto: ${e.message||e}`},{status:500});
  }
}
