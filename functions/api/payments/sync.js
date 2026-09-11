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

function monthOf(dateValue){
  if(!dateValue)return null;
  const s=String(dateValue).trim();
  const m=s.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function comparePeriods(a,b){
  return a===b ? 0 : (a<b ? -1 : 1);
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
  let cursor=start;
  let guard=0;
  while(comparePeriods(cursor,end)<=0 && guard<600){
    out.push(cursor);
    cursor=nextPeriod(cursor);
    guard++;
  }
  return out;
}

async function firstKnownPaymentPeriod(db,clientId){
  const row=await db.prepare(`
    SELECT COALESCE(period, substr(due_date,1,7), substr(paid_date,1,7)) AS p
    FROM payments
    WHERE client_id=? AND type='Canone'
      AND COALESCE(period, substr(due_date,1,7), substr(paid_date,1,7)) IS NOT NULL
    ORDER BY p ASC
    LIMIT 1
  `).bind(clientId).first();
  return row?.p || null;
}

async function ensureMonthlyPayment(db,client,period){
  // Evita duplicati anche con i vecchi pagamenti manuali senza campo period valorizzato.
  const existing=await db.prepare(`
    SELECT id,period,auto_generated
    FROM payments
    WHERE client_id=?
      AND type='Canone'
      AND (
        period=? OR
        (period IS NULL AND substr(due_date,1,7)=?) OR
        (period IS NULL AND due_date IS NULL AND substr(paid_date,1,7)=?)
      )
    ORDER BY id ASC
    LIMIT 1
  `).bind(client.id,period,period,period).first();

  if(existing){
    // Completa il periodo dei vecchi record così da renderli coerenti con le statistiche.
    if(!existing.period){
      await db.prepare(`UPDATE payments SET period=? WHERE id=?`).bind(period,existing.id).run();
    }
    return {created:false,existing:true};
  }

  const due=dueDateFor(period,client.billing_day||30);
  await db.prepare(`
    INSERT INTO payments(
      client_id,type,amount,due_date,status,reference,period,auto_generated,notes
    ) VALUES(?,?,?,?,?,?,?,?,?)
  `).bind(
    client.id,
    'Canone',
    Number(client.monthly_value||0),
    due,
    'Da pagare',
    `AUTO-${client.id}-${period}`,
    period,
    1,
    'Canone mensile generato automaticamente da EFFE OS in base alla durata del rapporto cliente'
  ).run();
  return {created:true,existing:false};
}

export async function onRequestPost({env}){
  const db=env.DB;
  if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});

  const today=new Date().toISOString().slice(0,10);
  const nowPeriod=currentPeriod();

  const clientCols=(await db.prepare('PRAGMA table_info(clients)').all()).results||[];
  const paymentCols=(await db.prepare('PRAGMA table_info(payments)').all()).results||[];
  const transactionCols=(await db.prepare('PRAGMA table_info(transactions)').all()).results||[];

  const requiredClient=['auto_billing','billing_day'];
  const requiredPayment=['period','auto_generated'];
  const requiredTransaction=['payment_id'];
  if(requiredClient.some(n=>!clientCols.some(c=>c.name===n)) ||
     requiredPayment.some(n=>!paymentCols.some(c=>c.name===n)) ||
     requiredTransaction.some(n=>!transactionCols.some(c=>c.name===n))){
    return Response.json({error:'Migrazione pagamenti automatici non eseguita completamente'},{status:400});
  }

  // IMPORTANTE: non filtriamo più per status='Attivo'.
  // Il periodo valido viene deciso da data inizio/fine rapporto.
  const clients=(await db.prepare(`
    SELECT id,name,monthly_value,start_date,end_date,created_at,auto_billing,billing_day,status
    FROM clients
    WHERE COALESCE(monthly_value,0)>0
      AND COALESCE(auto_billing,1)=1
    ORDER BY id ASC
  `).all()).results||[];

  let created=0;
  let existing=0;
  let considered=0;
  const details=[];

  for(const client of clients){
    // Inizio: data contratto -> primo pagamento noto -> data creazione cliente -> mese corrente.
    let startPeriod=monthOf(client.start_date);
    if(!startPeriod)startPeriod=await firstKnownPaymentPeriod(db,client.id);
    if(!startPeriod)startPeriod=monthOf(client.created_at);
    if(!startPeriod)startPeriod=nowPeriod;

    // Fine: mese della data fine incluso. Se non esiste, arriviamo al mese corrente.
    const contractEnd=monthOf(client.end_date);
    const endPeriod=contractEnd && comparePeriods(contractEnd,nowPeriod)<0 ? contractEnd : nowPeriod;

    // Contratto futuro oppure date incoerenti: nessuna rata da generare per ora.
    if(comparePeriods(startPeriod,nowPeriod)>0 || comparePeriods(startPeriod,endPeriod)>0){
      details.push({client_id:client.id,name:client.name,created:0,skipped:true,reason:'Fuori periodo contratto'});
      continue;
    }

    const periods=periodsBetween(startPeriod,endPeriod);
    let clientCreated=0;
    for(const period of periods){
      const result=await ensureMonthlyPayment(db,client,period);
      if(result.created){created++;clientCreated++;}
      else existing++;
    }
    considered++;
    details.push({
      client_id:client.id,
      name:client.name,
      start_period:startPeriod,
      end_period:endPeriod,
      contract_end:client.end_date||null,
      months_checked:periods.length,
      created:clientCreated
    });
  }

  // Aggiorna lo stato dei pagamenti aperti in base alla scadenza.
  await db.prepare(`
    UPDATE payments
    SET status='Scaduto'
    WHERE status='Da pagare'
      AND due_date IS NOT NULL
      AND due_date<?
  `).bind(today).run();

  // Se un pagamento pagato non ha ancora la relativa Entrata, la crea una sola volta.
  const paid=(await db.prepare(`
    SELECT p.id,p.client_id,p.amount,p.paid_date,p.due_date,p.period,c.name AS client_name
    FROM payments p
    LEFT JOIN clients c ON c.id=p.client_id
    WHERE p.status='Pagato'
  `).all()).results||[];

  let transactionsCreated=0;
  for(const payment of paid){
    const transaction=await db.prepare(`SELECT id FROM transactions WHERE payment_id=? LIMIT 1`).bind(payment.id).first();
    if(transaction)continue;
    const date=payment.paid_date||payment.due_date||today;
    await db.prepare(`
      INSERT INTO transactions(
        client_id,payment_id,direction,date,category,amount,description,notes
      ) VALUES(?,?,?,?,?,?,?,?)
    `).bind(
      payment.client_id,
      payment.id,
      'Entrata',
      date,
      'Canone cliente',
      Number(payment.amount||0),
      `Incasso ${payment.client_name||'cliente'}${payment.period?` - ${payment.period}`:''}`,
      'Generato automaticamente da pagamento confermato'
    ).run();
    transactionsCreated++;
  }

  return Response.json({
    ok:true,
    current_period:nowPeriod,
    clients_considered:considered,
    payments_created:created,
    payments_existing:existing,
    transactions_created:transactionsCreated,
    details
  });
}
