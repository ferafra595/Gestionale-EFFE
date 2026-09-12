function currentPeriod(){const d=new Date();return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`}
function lastDay(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate()}
function dueDateFor(period,day){const [y,m]=period.split('-').map(Number),d=Math.min(Math.max(Number(day||30),1),lastDay(y,m));return `${period}-${String(d).padStart(2,'0')}`}
function monthOf(v){if(!v)return null;const m=String(v).trim().match(/^(\d{4})-(\d{2})/);return m?`${m[1]}-${m[2]}`:null}
function nextPeriod(p){let [y,m]=p.split('-').map(Number);m++;if(m===13){m=1;y++}return `${y}-${String(m).padStart(2,'0')}`}
function periodsBetween(start,end){const out=[];if(!start||!end||start>end)return out;let p=start,g=0;while(p<=end&&g++<600){out.push(p);p=nextPeriod(p)}return out}
function effectiveTxDate(p,today){if(Number(p.auto_generated||0)===1 && p.due_date)return p.due_date;return p.paid_date||p.due_date||today}

export async function onRequestPost({env}){
  const db=env.DB;if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  const nowPeriod=currentPeriod(),today=new Date().toISOString().slice(0,10);
  const clients=(await db.prepare(`SELECT id,name,status,monthly_value,package_start_date,package_end_date,start_date,end_date,auto_billing,billing_day FROM clients ORDER BY id`).all()).results||[];
  const payments=(await db.prepare(`SELECT id,client_id,type,amount,due_date,paid_date,status,period,auto_generated FROM payments WHERE type='Canone'`).all()).results||[];
  const activeIds=new Set(clients.filter(c=>c.status==='Attivo'&&Number(c.monthly_value||0)>0&&Number(c.auto_billing??1)===1).map(c=>String(c.id)));
  const byClient=new Map();for(const p of payments){const k=String(p.client_id);if(!byClient.has(k))byClient.set(k,[]);byClient.get(k).push(p)}

  const statements=[];let created=0,updated=0,removed=0;

  // Clienti non attivi: rimuove solo le rate automatiche ancora aperte. Lo storico pagato resta nel DB,
  // ma viene escluso dalle schermate/statistiche finché il cliente non torna Attivo.
  for(const p of payments){
    if(Number(p.auto_generated||0)===1 && !activeIds.has(String(p.client_id)) && !['Pagato','Annullato'].includes(p.status)){
      statements.push(db.prepare(`DELETE FROM payments WHERE id=?`).bind(p.id));removed++;
    }
  }

  for(const c of clients){
    if(!activeIds.has(String(c.id)))continue;
    const start=monthOf(c.package_start_date)||monthOf(c.start_date),rawEnd=monthOf(c.package_end_date)||monthOf(c.end_date);
    if(!start)continue;
    const end=rawEnd&&rawEnd<nowPeriod?rawEnd:nowPeriod;
    const valid=new Set(periodsBetween(start,end)),rows=byClient.get(String(c.id))||[];

    for(const p of rows){
      const pp=p.period||monthOf(p.due_date)||monthOf(p.paid_date);
      if(Number(p.auto_generated||0)===1 && !['Pagato','Annullato'].includes(p.status) && pp && !valid.has(pp)){
        statements.push(db.prepare(`DELETE FROM payments WHERE id=?`).bind(p.id));removed++;
      }
    }

    for(const period of valid){
      const existing=rows.find(p=>(p.period||monthOf(p.due_date)||monthOf(p.paid_date))===period),due=dueDateFor(period,c.billing_day||30),status=due<today?'Scaduto':'Da pagare';
      if(existing){
        if(!existing.period)statements.push(db.prepare(`UPDATE payments SET period=? WHERE id=?`).bind(period,existing.id));
        if(Number(existing.auto_generated||0)===1 && !['Pagato','Annullato'].includes(existing.status)){
          statements.push(db.prepare(`UPDATE payments SET amount=?,due_date=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(Number(c.monthly_value||0),due,status,existing.id));updated++;
        }
      }else{
        statements.push(db.prepare(`INSERT INTO payments(client_id,type,amount,due_date,status,reference,period,auto_generated,notes) VALUES(?,?,?,?,?,?,?,?,?)`).bind(c.id,'Canone',Number(c.monthly_value||0),due,status,`AUTO-${c.id}-${period}`,period,1,'Canone mensile generato automaticamente dal periodo pacchetto EFFE OS'));created++;
      }
    }
  }
  if(statements.length)await db.batch(statements);
  await db.prepare(`UPDATE payments SET status='Scaduto' WHERE status='Da pagare' AND due_date IS NOT NULL AND due_date<?`).bind(today).run();

  // Allinea sempre i movimenti ai pagamenti: crea quelli mancanti, corregge importo/data/cliente/descrizione
  // e rimuove eventuali movimenti collegati a pagamenti che non risultano più Pagati.
  const paid=(await db.prepare(`SELECT p.id,p.client_id,p.amount,p.paid_date,p.due_date,p.period,p.auto_generated,p.status,c.name client_name,t.id tx_id FROM payments p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN transactions t ON t.payment_id=p.id`).all()).results||[];
  const txStatements=[];let txCreated=0,txUpdated=0,txRemoved=0;
  for(const p of paid){
    if(p.status==='Pagato'){
      const txDate=effectiveTxDate(p,today),description=`Incasso ${p.client_name||'cliente'}${p.period?` - ${p.period}`:''}`;
      if(p.tx_id){
        txStatements.push(db.prepare(`UPDATE transactions SET client_id=?,direction='Entrata',date=?,category='Canone cliente',amount=?,description=?,notes='Generato automaticamente da pagamento confermato',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(p.client_id,txDate,Number(p.amount||0),description,p.tx_id));txUpdated++;
      }else{
        txStatements.push(db.prepare(`INSERT INTO transactions(client_id,payment_id,direction,date,category,amount,description,notes) VALUES(?,?,?,?,?,?,?,?)`).bind(p.client_id,p.id,'Entrata',txDate,'Canone cliente',Number(p.amount||0),description,'Generato automaticamente da pagamento confermato'));txCreated++;
      }
    }else if(p.tx_id){
      txStatements.push(db.prepare(`DELETE FROM transactions WHERE id=?`).bind(p.tx_id));txRemoved++;
    }
  }
  if(txStatements.length)await db.batch(txStatements);

  return Response.json({ok:true,current_period:nowPeriod,payments_created:created,payments_updated:updated,payments_removed:removed,transactions_created:txCreated,transactions_updated:txUpdated,transactions_removed:txRemoved});
}
