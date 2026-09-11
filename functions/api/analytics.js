function socialBundle(row){
  try{const n=JSON.parse(row?.notes||'{}');if(n.kind==='social_package')return {posts:Number(n.posts||0),reels:Number(n.reels||0),stories:Number(n.stories||0)}}catch{}
  return null;
}
export async function onRequestGet({env}){
  const db=env.DB, month=new Date().toISOString().slice(0,7);
  const one=async(q,...b)=>(await db.prepare(q).bind(...b).first())||{};
  const clients=(await one('SELECT COUNT(*) v FROM clients')).v||0;
  const active=(await one("SELECT COUNT(*) v FROM clients WHERE status='Attivo'")).v||0;
  const leads=(await one('SELECT COUNT(*) v FROM leads')).v||0;
  const won=(await one("SELECT COUNT(*) v FROM leads WHERE stage='Vinto'")).v||0;
  const avg=(await one("SELECT COALESCE(AVG(monthly_value),0) v FROM clients WHERE status='Attivo'")).v||0;
  const mrr=(await one("SELECT COALESCE(SUM(monthly_value),0) v FROM clients WHERE status='Attivo'")).v||0;
  const equip=(await one('SELECT COALESCE(SUM(purchase_cost),0) v FROM equipment')).v||0;
  const pipeline=(await one("SELECT COALESCE(SUM(value),0) v FROM projects WHERE status NOT IN ('Consegnato')")).v||0;
  const published=(await one("SELECT COUNT(*) v FROM content WHERE substr(date,1,7)=? AND status IN ('Pubblicato','Programmato','Approvato')",month)).v||0;
  const monthly=(await db.prepare(`SELECT substr(date,1,7) month,SUM(CASE WHEN direction='Entrata' THEN amount ELSE 0 END) revenue FROM transactions WHERE date>=date('now','-6 months') GROUP BY substr(date,1,7) ORDER BY month`).all()).results||[];
  const statusMix=(await db.prepare(`SELECT COALESCE(status,'Senza stato') status,COUNT(*) count FROM clients GROUP BY status ORDER BY count DESC`).all()).results||[];
  const rows=(await db.prepare(`SELECT cs.*,s.name service_name FROM client_services cs LEFT JOIN services s ON s.id=cs.service_id JOIN clients c ON c.id=cs.client_id WHERE c.status='Attivo'`).all()).results||[];
  let social={posts:0,reels:0,stories:0};
  const counts=new Map();
  for(const r of rows){
    const sb=socialBundle(r);
    if(sb){social.posts+=sb.posts;social.reels+=sb.reels;social.stories+=sb.stories;counts.set('Gestione Social',(counts.get('Gestione Social')||0)+1)}
    else {const name=r.custom_name||r.service_name||'Personalizzato';counts.set(name,(counts.get(name)||0)+1)}
  }
  const total=[...counts.values()].reduce((a,b)=>a+b,0)||1;
  const serviceMix=[...counts.entries()].map(([name,count])=>({name,count,percent:Math.round(count/total*100)})).sort((a,b)=>b.count-a.count);
  return Response.json({clients,activeClients:active,leads,conversionRate:leads?Math.round(won/leads*100):0,avgClientValue:avg,mrr,annualProjection:Number(mrr)*12,equipmentValue:equip,projectPipeline:pipeline,publishedMonth:published,plannedContent:social.posts+social.reels+social.stories,social,monthly,serviceMix,statusMix});
}
