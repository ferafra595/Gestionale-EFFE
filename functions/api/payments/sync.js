function currentPeriod(){const d=new Date();return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`}
function lastDay(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate()}
function dueDateFor(period,day){const [y,m]=period.split('-').map(Number),d=Math.min(Math.max(Number(day||30),1),lastDay(y,m));return `${period}-${String(d).padStart(2,'0')}`}
function monthOf(v){if(!v)return null;const m=String(v).trim().match(/^(\d{4})-(\d{2})/);return m?`${m[1]}-${m[2]}`:null}
function nextPeriod(p){let [y,m]=p.split('-').map(Number);m++;if(m===13){m=1;y++}return `${y}-${String(m).padStart(2,'0')}`}
function periodsBetween(start,end){const out=[];if(!start||!end||start>end)return out;let p=start,g=0;while(p<=end&&g++<600){out.push(p);p=nextPeriod(p)}return out}

export async function onRequestPost({env}){
  const db=env.DB;if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  const nowPeriod=currentPeriod(),today=new Date().toISOString().slice(0,10);

  // 1) Una sola query elimina le rate automatiche ancora aperte dei clienti non attivi.
  const removedInactive=await db.prepare(`
    DELETE FROM payments
    WHERE type='Canone' AND auto_generated=1
      AND status NOT IN ('Pagato','Annullato')
      AND client_id IN (SELECT id FROM clients WHERE status<>'Attivo')
  `).run();

  // 2) Carica solo i clienti che possono generare canoni.
  const clients=(await db.prepare(`
    SELECT id,name,monthly_value,package_start_date,package_end_date,start_date,end_date,auto_billing,billing_day
    FROM clients
    WHERE status='Attivo' AND monthly_value>0 AND COALESCE(auto_billing,1)=1
    ORDER BY id
  `).all()).results||[];

  if(!clients.length){
    await db.prepare(`UPDATE payments SET status='Scaduto' WHERE status='Da pagare' AND due_date IS NOT NULL AND due_date<?`).bind(today).run();
    return Response.json({ok:true,current_period:nowPeriod,payments_created:0,payments_updated:0,payments_removed:Number(removedInactive.meta?.changes||0)});
  }

  const ids=clients.map(c=>Number(c.id)).filter(Boolean);
  const placeholders=ids.map(()=>'?').join(',');
  const payments=(await db.prepare(`
    SELECT id,client_id,amount,due_date,paid_date,status,period,auto_generated
    FROM payments
    WHERE type='Canone' AND client_id IN (${placeholders})
  `).bind(...ids).all()).results||[];

  const byClient=new Map();
  for(const p of payments){const k=String(p.client_id);if(!byClient.has(k))byClient.set(k,[]);byClient.get(k).push(p)}

  const statements=[];let created=0,updated=0,removed=Number(removedInactive.meta?.changes||0);

  for(const c of clients){
    const start=monthOf(c.package_start_date)||monthOf(c.start_date),rawEnd=monthOf(c.package_end_date)||monthOf(c.end_date);
    if(!start||start>nowPeriod)continue;
    const end=rawEnd&&rawEnd<nowPeriod?rawEnd:nowPeriod;
    const valid=new Set(periodsBetween(start,end)),rows=byClient.get(String(c.id))||[];
    const rowByPeriod=new Map();
    for(const p of rows){const pp=p.period||monthOf(p.due_date)||monthOf(p.paid_date);if(pp&&!rowByPeriod.has(pp))rowByPeriod.set(pp,p)}

    // Elimina solo rate automatiche aperte fuori dal periodo valido.
    for(const p of rows){
      const pp=p.period||monthOf(p.due_date)||monthOf(p.paid_date);
      if(Number(p.auto_generated||0)===1&&!['Pagato','Annullato'].includes(p.status)&&pp&&!valid.has(pp)){
        statements.push(db.prepare(`DELETE FROM payments WHERE id=?`).bind(p.id));removed++;
      }
    }

    for(const period of valid){
      const existing=rowByPeriod.get(period),due=dueDateFor(period,c.billing_day||30),status=due<today?'Scaduto':'Da pagare',amount=Number(c.monthly_value||0);
      if(existing){
        const needsPeriod=!existing.period;
        const autoOpen=Number(existing.auto_generated||0)===1&&!['Pagato','Annullato'].includes(existing.status);
        const needsCore=autoOpen&&(Number(existing.amount||0)!==amount||String(existing.due_date||'')!==due||String(existing.status||'')!==status);
        if(needsPeriod&&needsCore){
          statements.push(db.prepare(`UPDATE payments SET period=?,amount=?,due_date=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(period,amount,due,status,existing.id));updated++;
        }else if(needsPeriod){
          statements.push(db.prepare(`UPDATE payments SET period=? WHERE id=?`).bind(period,existing.id));updated++;
        }else if(needsCore){
          statements.push(db.prepare(`UPDATE payments SET amount=?,due_date=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(amount,due,status,existing.id));updated++;
        }
      }else{
        statements.push(db.prepare(`INSERT INTO payments(client_id,type,amount,due_date,status,reference,period,auto_generated,notes) VALUES(?,?,?,?,?,?,?,?,?)`).bind(c.id,'Canone',amount,due,status,`AUTO-${c.id}-${period}`,period,1,'Canone mensile generato automaticamente dal periodo pacchetto EFFE OS'));created++;
      }
    }
  }

  if(statements.length)await db.batch(statements);
  await db.prepare(`UPDATE payments SET status='Scaduto' WHERE status='Da pagare' AND due_date IS NOT NULL AND due_date<?`).bind(today).run();

  // I movimenti non vengono più riscritti a ogni sincronizzazione.
  // Nascono/si aggiornano quando premi "Conferma incasso" nell'endpoint approve.js.
  return Response.json({ok:true,current_period:nowPeriod,payments_created:created,payments_updated:updated,payments_removed:removed});
}
