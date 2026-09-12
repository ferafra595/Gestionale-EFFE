const daysBetween=(a,b)=>Math.ceil((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/864e5);
export async function onRequestGet({env}){
  const db=env.DB;if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  const today=new Date().toISOString().slice(0,10);
  const [pay,packages,contracts,invoices,subs,equip]=await db.batch([
    db.prepare(`SELECT p.id,p.due_date date,p.amount,c.name client_name,'Pagamento' kind,p.status status FROM payments p JOIN clients c ON c.id=p.client_id WHERE c.status='Attivo' AND p.status IN ('Da pagare','Scaduto') AND p.due_date IS NOT NULL`),
    db.prepare(`SELECT id,package_end_date date,name client_name,'Fine pacchetto' kind,'Attivo' status FROM clients WHERE status='Attivo' AND package_end_date IS NOT NULL`),
    db.prepare(`SELECT co.id,co.end_date date,c.name client_name,'Contratto' kind,co.status status,co.title title FROM contracts co LEFT JOIN clients c ON c.id=co.client_id WHERE co.end_date IS NOT NULL AND COALESCE(co.status,'') NOT IN ('Annullato','Scaduto')`),
    db.prepare(`SELECT i.id,i.due_date date,c.name client_name,'Fattura' kind,i.status status,i.total amount FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.due_date IS NOT NULL AND COALESCE(i.status,'') NOT IN ('Pagata','Annullata')`),
    db.prepare(`SELECT id,renewal_date date,name client_name,'Abbonamento' kind,status,amount FROM subscriptions WHERE renewal_date IS NOT NULL AND COALESCE(status,'Attivo') NOT IN ('Chiuso','Disdetto','Annullato')`),
    db.prepare(`SELECT id,warranty_end date,name client_name,'Garanzia' kind,status FROM equipment WHERE warranty_end IS NOT NULL AND COALESCE(status,'Operativo')<>'Dismesso'`)
  ]);
  const raw=[...(pay.results||[]),...(packages.results||[]),...(contracts.results||[]),...(invoices.results||[]),...(subs.results||[]),...(equip.results||[])];
  const items=raw.map(x=>{
    const days=daysBetween(today,x.date),urgency=days<0?'Scaduta':days<=7?'Urgente':days<=30?'Prossima':'Futura';
    const group=['Pagamento','Fine pacchetto','Contratto','Fattura'].includes(x.kind)?'Clienti':'Agenzia';
    return {...x,days,urgency,group};
  }).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const counts={all:items.length,overdue:items.filter(x=>x.days<0).length,urgent:items.filter(x=>x.days>=0&&x.days<=7).length,next30:items.filter(x=>x.days>=0&&x.days<=30).length};
  return Response.json({today,counts,items});
}
