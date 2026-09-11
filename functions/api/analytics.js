function socialBundle(row){
  try{
    const n=JSON.parse(row?.notes||'{}');
    if(n.kind==='social_package')return {posts:Number(n.posts||0),reels:Number(n.reels||0),stories:Number(n.stories||0)};
  }catch{}
  return null;
}
const n=v=>Number(v||0);
const monthKey=()=>new Date().toISOString().slice(0,7);

export async function onRequestGet({env}){
  const db=env.DB;
  if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  const month=monthKey();
  const one=async(q,...b)=>(await db.prepare(q).bind(...b).first())||{};
  const all=async(q,...b)=>(await db.prepare(q).bind(...b).all()).results||[];

  const txCols=await all('PRAGMA table_info(transactions)');
  const hasTxClient=txCols.some(c=>c.name==='client_id');

  const clients=await all(`SELECT * FROM clients ORDER BY CASE WHEN status='Attivo' THEN 0 ELSE 1 END, name`);
  const activeClients=clients.filter(c=>c.status==='Attivo');
  const clientServices=await all(`SELECT cs.*,s.name service_name FROM client_services cs LEFT JOIN services s ON s.id=cs.service_id`);
  const content=await all(`SELECT * FROM content`);
  const invoices=await all(`SELECT * FROM invoices`);
  const payments=await all(`SELECT * FROM payments`);
  const projects=await all(`SELECT * FROM projects`);
  const ads=await all(`SELECT * FROM ads`);
  const contracts=await all(`SELECT * FROM contracts`);
  const websites=await all(`SELECT * FROM websites`);
  const transactions=hasTxClient?await all(`SELECT * FROM transactions`):[];

  const serviceCount=new Map();
  let socialTotal={posts:0,reels:0,stories:0};
  for(const r of clientServices){
    const c=clients.find(x=>String(x.id)===String(r.client_id));
    if(!c||c.status!=='Attivo')continue;
    const sb=socialBundle(r);
    if(sb){
      socialTotal.posts+=sb.posts;socialTotal.reels+=sb.reels;socialTotal.stories+=sb.stories;
      serviceCount.set('Gestione Social',(serviceCount.get('Gestione Social')||0)+1);
    }else{
      const name=r.custom_name||r.service_name||'Personalizzato';
      serviceCount.set(name,(serviceCount.get(name)||0)+1);
    }
  }
  const mixTotal=[...serviceCount.values()].reduce((a,b)=>a+b,0)||1;
  const serviceMix=[...serviceCount.entries()].map(([name,count])=>({name,count,percent:Math.round(count/mixTotal*100)})).sort((a,b)=>b.count-a.count);

  const clientStats=clients.map(c=>{
    const cid=String(c.id);
    const services=clientServices.filter(x=>String(x.client_id)===cid);
    const socialRow=services.find(socialBundle);
    const social=socialBundle(socialRow)||{posts:0,reels:0,stories:0};
    const planned=social.posts+social.reels+social.stories;
    const cc=content.filter(x=>String(x.client_id)===cid);
    const monthContent=cc.filter(x=>String(x.date||'').slice(0,7)===month);
    const publishedMonth=monthContent.filter(x=>['Pubblicato','Programmato','Approvato'].includes(x.status)).length;
    const doneByType={post:0,reel:0,story:0};
    for(const x of monthContent.filter(x=>['Pubblicato','Programmato','Approvato'].includes(x.status))){
      const t=String(x.type||'').toLowerCase();
      if(t.includes('reel'))doneByType.reel++;
      else if(t.includes('story'))doneByType.story++;
      else if(t.includes('post')||t.includes('caros'))doneByType.post++;
    }

    const inv=invoices.filter(x=>String(x.client_id)===cid);
    const invoiceIssued=inv.reduce((s,x)=>s+n(x.total),0);
    const invoicePaid=inv.filter(x=>/pagata/i.test(x.status||'')).reduce((s,x)=>s+n(x.total),0);
    const invoiceOutstanding=inv.filter(x=>!/pagata|annullata/i.test(x.status||'')).reduce((s,x)=>s+n(x.total),0);

    const pp=payments.filter(x=>String(x.client_id)===cid);
    const paymentsPaid=pp.filter(x=>/pagat/i.test(x.status||'')).reduce((s,x)=>s+n(x.amount),0);
    const paymentsPending=pp.filter(x=>!/pagat/i.test(x.status||'')).reduce((s,x)=>s+n(x.amount),0);
    const overduePayments=pp.filter(x=>!/pagat/i.test(x.status||'')&&x.due_date&&x.due_date<new Date().toISOString().slice(0,10)).reduce((s,x)=>s+n(x.amount),0);

    const pr=projects.filter(x=>String(x.client_id)===cid);
    const projectRevenue=pr.reduce((s,x)=>s+n(x.value),0);
    const projectCosts=pr.reduce((s,x)=>s+n(x.cost),0);
    const openProjectValue=pr.filter(x=>x.status!=='Consegnato').reduce((s,x)=>s+n(x.value),0);

    const tx=transactions.filter(x=>String(x.client_id)===cid);
    const actualIncome=tx.filter(x=>x.direction==='Entrata').reduce((s,x)=>s+n(x.amount),0);
    const actualExpense=tx.filter(x=>x.direction==='Uscita').reduce((s,x)=>s+n(x.amount),0);

    const aa=ads.filter(x=>String(x.client_id)===cid&&String(x.period||'')===month);
    const adSpend=aa.reduce((s,x)=>s+n(x.spend),0);
    const adLeads=aa.reduce((s,x)=>s+n(x.leads),0);
    const adRevenue=aa.reduce((s,x)=>s+n(x.revenue),0);

    const nearestContract=contracts.filter(x=>String(x.client_id)===cid&&x.end_date).sort((a,b)=>String(a.end_date).localeCompare(String(b.end_date)))[0];
    const renewals=websites.filter(x=>String(x.client_id)===cid).map(x=>x.domain_renewal||x.hosting_renewal).filter(Boolean).sort();

    const months=[];
    for(let i=11;i>=0;i--){
      const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-i);
      const mk=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const mm=tx.filter(x=>String(x.date||'').slice(0,7)===mk);
      months.push({month:mk,revenue:mm.filter(x=>x.direction==='Entrata').reduce((s,x)=>s+n(x.amount),0),expense:mm.filter(x=>x.direction==='Uscita').reduce((s,x)=>s+n(x.amount),0)});
    }

    return {
      id:c.id,name:c.name,status:c.status,relationship_type:c.relationship_type||'',start_date:c.start_date||'',end_date:c.end_date||'',
      monthlyValue:n(c.monthly_value),annualRecurring:n(c.monthly_value)*12,projectDeclared:n(c.project_value),
      invoiceIssued,invoicePaid,invoiceOutstanding,paymentsPaid,paymentsPending,overduePayments,
      projectRevenue,projectCosts,openProjectValue,actualIncome,actualExpense,netActual:actualIncome-actualExpense,
      social:{...social,total:planned},publishedMonth,doneByType,
      adSpend,adLeads,adRevenue,
      contractEnd:nearestContract?.end_date||'',nextRenewal:renewals[0]||'',
      services:services.map(x=>x.custom_name||x.service_name||'Servizio').filter(Boolean),
      monthly:months
    };
  });

  const mrr=activeClients.reduce((s,c)=>s+n(c.monthly_value),0);
  const actualIncome=transactions.filter(x=>x.direction==='Entrata').reduce((s,x)=>s+n(x.amount),0);
  const actualExpense=transactions.filter(x=>x.direction==='Uscita').reduce((s,x)=>s+n(x.amount),0);
  const projectPipeline=projects.filter(x=>x.status!=='Consegnato').reduce((s,x)=>s+n(x.value),0);
  const publishedMonth=content.filter(x=>String(x.date||'').slice(0,7)===month&&['Pubblicato','Programmato','Approvato'].includes(x.status)).length;
  const statusMix=(await all(`SELECT COALESCE(status,'Senza stato') status,COUNT(*) count FROM clients GROUP BY status ORDER BY count DESC`));
  const leads=(await one('SELECT COUNT(*) v FROM leads')).v||0;
  const won=(await one("SELECT COUNT(*) v FROM leads WHERE stage='Vinto'")).v||0;
  const equipmentValue=(await one('SELECT COALESCE(SUM(purchase_cost),0) v FROM equipment')).v||0;

  return Response.json({
    activeClients:activeClients.length,totalClients:clients.length,mrr,annualProjection:mrr*12,
    avgClientValue:activeClients.length?mrr/activeClients.length:0,
    plannedContent:socialTotal.posts+socialTotal.reels+socialTotal.stories,social:socialTotal,publishedMonth,
    projectPipeline,equipmentValue,actualIncome,actualExpense,actualNet:actualIncome-actualExpense,
    leads,conversionRate:leads?Math.round(won/leads*100):0,serviceMix,statusMix,hasTxClient,clientStats
  });
}
