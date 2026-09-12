export async function onRequestGet({env}){
  const db=env.DB;if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  const nowDate=new Date(),month=nowDate.toISOString().slice(0,7),now=nowDate.toISOString().slice(0,10),in30=new Date(Date.now()+30*864e5).toISOString().slice(0,10);
  const activeTx=`(transactions.client_id IS NULL OR EXISTS(SELECT 1 FROM clients cta WHERE cta.id=transactions.client_id AND cta.status='Attivo'))`;
  const qs=[
    db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE direction='Entrata' AND substr(date,1,7)=? AND ${activeTx}`).bind(month),
    db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE direction='Uscita' AND substr(date,1,7)=? AND ${activeTx}`).bind(month),
    db.prepare(`SELECT COALESCE(SUM(monthly_value),0) v FROM clients WHERE status='Attivo' AND COALESCE(package_start_date,start_date)<=? AND (COALESCE(package_end_date,end_date) IS NULL OR COALESCE(package_end_date,end_date)>=?)`).bind(now,now),
    db.prepare(`SELECT COUNT(*) v FROM clients WHERE status='Attivo'`),
    db.prepare(`SELECT COALESCE(SUM(p.amount),0) v FROM payments p JOIN clients c ON c.id=p.client_id WHERE c.status='Attivo' AND COALESCE(p.period,substr(p.due_date,1,7))=? AND p.status<>'Annullato'`).bind(month),
    db.prepare(`SELECT COALESCE(SUM(p.amount),0) v FROM payments p JOIN clients c ON c.id=p.client_id WHERE c.status='Attivo' AND COALESCE(p.period,substr(p.due_date,1,7))=? AND p.status='Pagato'`).bind(month),
    db.prepare(`SELECT COALESCE(SUM(p.amount),0) v FROM payments p JOIN clients c ON c.id=p.client_id WHERE c.status='Attivo' AND COALESCE(p.period,substr(p.due_date,1,7))=? AND p.status IN ('Da pagare','Scaduto')`).bind(month),
    db.prepare(`SELECT COUNT(*) v FROM payments p JOIN clients c ON c.id=p.client_id WHERE c.status='Attivo' AND (p.status='Scaduto' OR (p.status='Da pagare' AND p.due_date<?))`).bind(now),
    db.prepare(`SELECT COUNT(*) v FROM clients WHERE status='Attivo' AND package_end_date BETWEEN ? AND ?`).bind(now,in30),
    db.prepare(`SELECT COUNT(*) v FROM leads WHERE COALESCE(stage,'') NOT IN ('Cliente','Perso')`),
    db.prepare(`SELECT COUNT(*) v FROM leads WHERE COALESCE(stage,'') NOT IN ('Cliente','Perso') AND next_contact IS NOT NULL AND next_contact<=?`).bind(now),
    db.prepare(`SELECT COUNT(*) v FROM clients c WHERE c.status='Attivo' AND NOT EXISTS(SELECT 1 FROM reports r WHERE r.client_id=c.id AND r.period=?)`).bind(month)
  ];
  const [rev,cost,mrr,active,expectedMonth,paidMonth,pendingMonth,overdue,ending,openLeads,dueLeads,missingReports]=await db.batch(qs);
  const monthly=(await db.prepare(`SELECT substr(transactions.date,1,7) month,SUM(CASE WHEN direction='Entrata' THEN amount ELSE 0 END) revenue,SUM(CASE WHEN direction='Uscita' THEN amount ELSE 0 END) costs FROM transactions WHERE date>=date('now','-6 months') AND ${activeTx} GROUP BY substr(transactions.date,1,7) ORDER BY month`).all()).results||[];

  const actions=[];
  const overdueRows=(await db.prepare(`SELECT p.id,p.amount,p.due_date,c.name client_name FROM payments p JOIN clients c ON c.id=p.client_id WHERE c.status='Attivo' AND (p.status='Scaduto' OR (p.status='Da pagare' AND p.due_date<?)) ORDER BY p.due_date LIMIT 6`).bind(now).all()).results||[];
  overdueRows.forEach(x=>actions.push({type:'payment',level:'danger',title:`Incasso scaduto · ${x.client_name}`,text:`${Number(x.amount||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})} · scadenza ${x.due_date}`,page:'payments',date:x.due_date}));
  const packageRows=(await db.prepare(`SELECT id,name,package_end_date FROM clients WHERE status='Attivo' AND package_end_date BETWEEN ? AND ? ORDER BY package_end_date LIMIT 6`).bind(now,in30).all()).results||[];
  packageRows.forEach(x=>actions.push({type:'package',level:'warn',title:`Pacchetto in scadenza · ${x.name}`,text:`Termina il ${x.package_end_date}`,page:'deadlines',date:x.package_end_date}));
  const leadRows=(await db.prepare(`SELECT id,name,next_contact,stage FROM leads WHERE COALESCE(stage,'') NOT IN ('Cliente','Perso') AND next_contact IS NOT NULL AND next_contact<=? ORDER BY next_contact LIMIT 6`).bind(now).all()).results||[];
  leadRows.forEach(x=>actions.push({type:'lead',level:'info',title:`Follow-up CRM · ${x.name}`,text:`${x.stage||'Lead'} · contatto previsto ${x.next_contact}`,page:'leads',date:x.next_contact}));
  const reportRows=(await db.prepare(`SELECT c.id,c.name FROM clients c WHERE c.status='Attivo' AND NOT EXISTS(SELECT 1 FROM reports r WHERE r.client_id=c.id AND r.period=?) ORDER BY c.name LIMIT 6`).bind(month).all()).results||[];
  reportRows.forEach(x=>actions.push({type:'report',level:'info',title:`Report mese mancante · ${x.name}`,text:`Nessun report registrato per ${month}`,page:'reports',date:now}));
  actions.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));

  const ov=Number(overdue.results?.[0]?.v||0),en=Number(ending.results?.[0]?.v||0),ld=Number(openLeads.results?.[0]?.v||0),dr=Number(dueLeads.results?.[0]?.v||0),mr=Number(missingReports.results?.[0]?.v||0);
  const health=Math.max(0,Math.min(100,100-ov*12-en*5-dr*3-Math.min(mr,10)*1.5));
  return Response.json({
    revenueMonth:Number(rev.results?.[0]?.v||0),
    profitMonth:Number(rev.results?.[0]?.v||0)-Number(cost.results?.[0]?.v||0),
    mrr:Number(mrr.results?.[0]?.v||0),activeClients:Number(active.results?.[0]?.v||0),
    expectedMonth:Number(expectedMonth.results?.[0]?.v||0),paidMonth:Number(paidMonth.results?.[0]?.v||0),pendingMonth:Number(pendingMonth.results?.[0]?.v||0),
    overduePayments:ov,endingPackages:en,openLeads:ld,dueLeads:dr,missingReports:mr,healthScore:Math.round(health),monthly,actions
  });
}
