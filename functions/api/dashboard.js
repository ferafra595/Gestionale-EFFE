export async function onRequestGet({env}){
  const db=env.DB;if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  const month=new Date().toISOString().slice(0,7),now=new Date().toISOString().slice(0,10),in30=new Date(Date.now()+30*864e5).toISOString().slice(0,10);
  const activeTx=`(transactions.client_id IS NULL OR EXISTS(SELECT 1 FROM clients cta WHERE cta.id=transactions.client_id AND cta.status='Attivo'))`;
  const qs=[
    db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE direction='Entrata' AND substr(date,1,7)=? AND ${activeTx}`).bind(month),
    db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE direction='Uscita' AND substr(date,1,7)=? AND ${activeTx}`).bind(month),
    db.prepare(`SELECT COALESCE(SUM(monthly_value),0) v FROM clients WHERE status='Attivo' AND COALESCE(package_start_date,start_date)<=? AND (COALESCE(package_end_date,end_date) IS NULL OR COALESCE(package_end_date,end_date)>=?)`).bind(now,now),
    db.prepare(`SELECT COALESCE(SUM(p.amount),0) v FROM payments p LEFT JOIN clients c ON c.id=p.client_id WHERE (p.client_id IS NULL OR c.status='Attivo') AND p.status IN ('Da pagare','Scaduto')`),
    db.prepare(`SELECT COUNT(*) v FROM clients WHERE status='Attivo'`),
    db.prepare(`SELECT COUNT(*) v FROM payments p LEFT JOIN clients c ON c.id=p.client_id WHERE (p.client_id IS NULL OR c.status='Attivo') AND (p.status='Scaduto' OR (p.status='Da pagare' AND p.due_date<?))`).bind(now),
    db.prepare(`SELECT COUNT(*) v FROM clients WHERE status='Attivo' AND package_end_date BETWEEN ? AND ?`).bind(now,in30),
    db.prepare(`SELECT COUNT(*) v FROM leads WHERE COALESCE(stage,'') NOT IN ('Cliente','Perso')`)
  ];
  const [rev,cost,mrr,collect,active,overdue,ending,openLeads]=await db.batch(qs);
  const monthly=(await db.prepare(`SELECT substr(transactions.date,1,7) month,SUM(CASE WHEN direction='Entrata' THEN amount ELSE 0 END) revenue,SUM(CASE WHEN direction='Uscita' THEN amount ELSE 0 END) costs FROM transactions WHERE date>=date('now','-6 months') AND ${activeTx} GROUP BY substr(transactions.date,1,7) ORDER BY month`).all()).results||[];
  const alerts=[];
  if(overdue.results?.[0]?.v)alerts.push({title:'Pagamenti scaduti',text:`${overdue.results[0].v} pagamento/i di clienti attivi richiedono attenzione`,level:'danger',label:'Incassi'});
  if(ending.results?.[0]?.v)alerts.push({title:'Pacchetti in scadenza',text:`${ending.results[0].v} pacchetto/i attivi terminano entro 30 giorni`,level:'warn',label:'Clienti'});
  if(openLeads.results?.[0]?.v)alerts.push({title:'Lead aperti',text:`${openLeads.results[0].v} opportunità ancora da gestire`,level:'info',label:'CRM'});
  const ov=Number(overdue.results?.[0]?.v||0),en=Number(ending.results?.[0]?.v||0),ld=Number(openLeads.results?.[0]?.v||0),health=Math.max(0,Math.min(100,100-ov*12-en*5-Math.min(ld,10)*2));
  return Response.json({revenueMonth:Number(rev.results?.[0]?.v||0),mrr:Number(mrr.results?.[0]?.v||0),toCollect:Number(collect.results?.[0]?.v||0),profitMonth:Number(rev.results?.[0]?.v||0)-Number(cost.results?.[0]?.v||0),activeClients:Number(active.results?.[0]?.v||0),overduePayments:ov,endingPackages:en,openLeads:ld,healthScore:health,monthly,alerts});
}
