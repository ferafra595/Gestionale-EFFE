function cleanDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):null}
function cleanInt(v,min=0,max=999){return Math.min(max,Math.max(min,Number(v||0)))}
async function ensureSocialService(db){
  let s=await db.prepare(`SELECT id FROM services WHERE lower(name)=lower('Social Media Management') LIMIT 1`).first();
  if(s?.id)return s.id;
  const r=await db.prepare(`INSERT INTO services(name,category,unit,description) VALUES('Social Media Management','Social','mese','Gestione strategica dei canali social')`).run();
  return r.meta.last_row_id;
}
async function upsertSocial(db,clientId,social){
  const serviceId=await ensureSocialService(db);
  const posts=cleanInt(social.posts),reels=cleanInt(social.reels),stories=cleanInt(social.stories),price=Math.max(0,Number(social.price||0));
  const notes=JSON.stringify({kind:'social_package',posts,reels,stories});
  const rows=await db.prepare(`SELECT id,notes FROM client_services WHERE client_id=? AND service_id=? ORDER BY id`).bind(clientId,serviceId).all();
  let current=(rows.results||[]).find(r=>{try{return JSON.parse(r.notes||'{}').kind==='social_package'}catch{return false}});
  if(current){
    await db.prepare(`UPDATE client_services SET custom_name='Gestione Social',quantity=?,period='month',price=?,notes=? WHERE id=?`)
      .bind(posts+reels+stories,price,notes,current.id).run();
  }else{
    const r=await db.prepare(`INSERT INTO client_services(client_id,service_id,custom_name,quantity,period,price,notes) VALUES(?,?,?,?,?,?,?)`)
      .bind(clientId,serviceId,'Gestione Social',posts+reels+stories,'month',price,notes).run();
    current={id:r.meta.last_row_id};
  }
  return {id:current.id,posts,reels,stories,price};
}
export async function onRequestPut({request,env,params}){
  const db=env.DB,rawId=Array.isArray(params.id)?params.id[0]:params.id,id=Number(rawId);
  if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  if(!id)return Response.json({error:'Cliente non valido'},{status:400});
  try{
    const data=await request.json();
    let client=null,social=null;
    if('package_start_date' in data || 'package_end_date' in data || 'monthly_value' in data || 'billing_day' in data || 'auto_billing' in data){
      const start=cleanDate(data.package_start_date),end=cleanDate(data.package_end_date);
      if(!start)return Response.json({error:'Inserisci la data di inizio pacchetto'},{status:400});
      if(end&&end<start)return Response.json({error:'La data fine non può essere precedente alla data inizio'},{status:400});
      const monthly=Math.max(0,Number(data.monthly_value||0));
      const billing=Math.min(31,Math.max(1,Number(data.billing_day||30)));
      const auto=Number(data.auto_billing)===0?0:1;
      await db.prepare(`UPDATE clients SET package_start_date=?,package_end_date=?,monthly_value=?,billing_day=?,auto_billing=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(start,end,monthly,billing,auto,id).run();
    }
    if(data.social) social=await upsertSocial(db,id,data.social);
    client=await db.prepare(`SELECT id,name,package_start_date,package_end_date,monthly_value,billing_day,auto_billing FROM clients WHERE id=?`).bind(id).first();
    return Response.json({ok:true,client,social});
  }catch(e){
    return Response.json({error:`Salvataggio pacchetto: ${e.message||e}`},{status:500});
  }
}
