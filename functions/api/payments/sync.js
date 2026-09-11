function currentPeriod(){
  const d=new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}

function lastDay(year,month){
  return new Date(Date.UTC(year,month,0)).getUTCDate();
}

function dueDateFor(period,day){
  const [year,month]=period.split('-').map(Number);
  const safeDay=Math.min(Math.max(Number(day||30),1),lastDay(year,month));
  return `${period}-${String(safeDay).padStart(2,'0')}`;
}

function monthOf(value){
  if(!value)return null;
  const s=String(value).trim();
  const m=s.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function comparePeriods(a,b){
  if(a===b)return 0;
  return a<b ? -1 : 1;
}

function minPeriod(values){
  return values.filter(Boolean).sort()[0]||null;
}

function nextPeriod(period){
  let [year,month]=period.split('-').map(Number);
  month++;
  if(month===13){month=1;year++;}
  return `${year}-${String(month).padStart(2,'0')}`;
}

function periodsBetween(start,end){
  const out=[];
  if(!start||!end||comparePeriods(start,end)>0)return out;
  let p=start,guard=0;
  while(comparePeriods(p,end)<=0 && guard<600){
    out.push(p);
    p=nextPeriod(p);
    guard++;
  }
  return out;
}

async function getContractInfo(db,clientId){
  const rows=(await db.prepare(`
    SELECT id,start_date,end_date,status
    FROM contracts
    WHERE client_id=? AND COALESCE(status,'')!='Annullato'
    ORDER BY COALESCE(start_date,'9999-12-31') ASC,id ASC
  `).bind(clientId).all()).results||[];

  let earliestStart=null;
  let latestClosedEnd=null;
  let hasOpenContract=false;
  for(const r of rows){
    const s=monthOf(r.start_date), e=monthOf(r.end_date);
    if(s && (!earliestStart || s<earliestStart))earliestStart=s;
    if(!r.end_date)hasOpenContract=true;
    if(e && (!latestClosedEnd || e>latestClosedEnd))latestClosedEnd=e;
  }
  return {earliestStart,latestClosedEnd,hasOpenContract,rows};
}

async function paymentBounds(db,clientId){
  const rows=(await db.prepare(`
    SELECT COALESCE(period,substr(due_date,1,7),substr(paid_date,1,7)) AS p
    FROM payments
    WHERE client_id=? AND type='Canone'
      AND COALESCE(period,substr(due_date,1,7),substr(paid_date,1,7)) IS NOT NULL
    ORDER BY p ASC
  `).bind(clientId).all()).results||[];
  return {
    first: rows.length?rows[0].p:null,
    last: rows.length?rows[rows.length-1].p:null
  };
}

async function ensureMonthlyPayment(db,client,period){
  // Qualsiasi canone già presente nello stesso mese vale come rata esistente,
  // anche se creato manualmente prima dell'automazione.
  const existing=await db.prepare(`
    SELECT id,period,auto_generated,status,due_date,paid_date,amount
    FROM payments
    WHERE client_id=? AND type='Canone'
      AND (
        period=? OR
        (period IS NULL AND substr(due_date,1,7)=?) OR
        (period IS NULL AND substr(paid_date,1,7)=?)
      )
    ORDER BY id ASC
    LIMIT 1
  `).bind(client.id,period,period,period).first();

  if(existing){
    // Completa i vecchi record senza modificarne importo o stato.
    if(!existing.period){
      await db.prepare(`UPDATE payments SET period=? WHERE id=?`).bind(period,existing.id).run();
    }
    return {created:false,id:existing.id,status:existing.status};
  }

  const due=dueDateFor(period,client.billing_day||30);
  const today=new Date().toISOString().slice(0,10);
  const status=due<today?'Scaduto':'Da pagare';
  const result=await db.prepare(`
    INSERT INTO payments(
      client_id,type,amount,due_date,status,reference,period,auto_generated,notes
    ) VALUES(?,?,?,?,?,?,?,?,?)
  `).bind(
    client.id,'Canone',Number(client.monthly_value||0),due,status,
    `AUTO-${client.id}-${period}`,period,1,
    'Canone mensile generato automaticamente da EFFE OS'
  ).run();
  return {created:true,id:result.meta?.last_row_id||null,status};
}

export async function onRequestPost({env}){
  const db=env.DB;
  if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});

  const nowPeriod=currentPeriod();
  const today=new Date().toISOString().slice(0,10);

  const clients=(await db.prepare(`
    SELECT id,name,monthly_value,start_date,end_date,created_at,
           auto_billing,billing_day,status
    FROM clients
    WHERE COALESCE(monthly_value,0)>0
      AND COALESCE(auto_billing,1)=1
    ORDER BY name ASC,id ASC
  `).all()).results||[];

  let created=0,existing=0;
  const details=[];

  for(const client of clients){
    const contract=await getContractInfo(db,client.id);
    const bounds=await paymentBounds(db,client.id);

    // INIZIO RAPPORTO = la data più vecchia conosciuta.
    // In questo modo recuperiamo anche tutti i mesi arretrati dei clienti già esistenti.
    const startPeriod=minPeriod([
      monthOf(client.start_date),
      contract.earliestStart,
      bounds.first,
      monthOf(client.created_at),
      nowPeriod
    ]);

    // FINE RAPPORTO:
    // 1) la data fine nella scheda cliente ha sempre priorità;
    // 2) una vecchia data fine in un contratto NON deve bloccare un cliente che oggi è ancora attivo;
    // 3) usiamo la fine del contratto solo se il cliente è effettivamente segnato come terminato/perso/inattivo.
    let explicitEnd=monthOf(client.end_date);
    const endedStatus=['Terminato','Perso','Inattivo','Chiuso','Scaduto'].includes(String(client.status||''));
    if(!explicitEnd && endedStatus && !contract.hasOpenContract){
      explicitEnd=contract.latestClosedEnd;
    }

    // Se non c'è una vera data fine, si genera SEMPRE fino al mese corrente.
    let endPeriod=explicitEnd && explicitEnd<nowPeriod ? explicitEnd : nowPeriod;

    if(!startPeriod || startPeriod>nowPeriod || startPeriod>endPeriod){
      details.push({client_id:client.id,name:client.name,skipped:true,start_period:startPeriod,end_period:endPeriod});
      continue;
    }

    const months=periodsBetween(startPeriod,endPeriod);
    let clientCreated=0;
    for(const period of months){
      const r=await ensureMonthlyPayment(db,client,period);
      if(r.created){created++;clientCreated++;}else existing++;
    }

    details.push({
      client_id:client.id,
      name:client.name,
      start_period:startPeriod,
      end_period:endPeriod,
      client_end_date:client.end_date||null,
      client_status:client.status||null,
      previous_first_payment:bounds.first,
      previous_last_payment:bounds.last,
      months_checked:months.length,
      payments_created:clientCreated
    });
  }

  // Aggiorna gli aperti scaduti.
  await db.prepare(`
    UPDATE payments
    SET status='Scaduto'
    WHERE status='Da pagare' AND due_date IS NOT NULL AND due_date<?
  `).bind(today).run();

  // Crea una sola entrata per ogni pagamento confermato.
  const paid=(await db.prepare(`
    SELECT p.id,p.client_id,p.amount,p.paid_date,p.due_date,p.period,c.name AS client_name
    FROM payments p
    LEFT JOIN clients c ON c.id=p.client_id
    WHERE p.status='Pagato'
  `).all()).results||[];

  let transactionsCreated=0;
  for(const payment of paid){
    const tx=await db.prepare(`SELECT id FROM transactions WHERE payment_id=? LIMIT 1`).bind(payment.id).first();
    if(tx)continue;
    const date=payment.paid_date||payment.due_date||today;
    await db.prepare(`
      INSERT INTO transactions(client_id,payment_id,direction,date,category,amount,description,notes)
      VALUES(?,?,?,?,?,?,?,?)
    `).bind(
      payment.client_id,payment.id,'Entrata',date,'Canone cliente',Number(payment.amount||0),
      `Incasso ${payment.client_name||'cliente'}${payment.period?` - ${payment.period}`:''}`,
      'Generato automaticamente da pagamento confermato'
    ).run();
    transactionsCreated++;
  }

  return Response.json({
    ok:true,
    current_period:nowPeriod,
    payments_created:created,
    payments_existing:existing,
    transactions_created:transactionsCreated,
    details
  });
}
