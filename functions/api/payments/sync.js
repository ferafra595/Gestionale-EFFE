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
  return a===b ? 0 : (a<b ? -1 : 1);
}

function nextPeriod(period){
  let [year,month]=period.split('-').map(Number);
  month++;
  if(month===13){ month=1; year++; }
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

async function contractRange(db,clientId){
  // Usa i contratti del cliente se le date non sono presenti nella scheda cliente.
  // Esclude solo i contratti esplicitamente annullati.
  const rows=(await db.prepare(`
    SELECT start_date,end_date,status,id
    FROM contracts
    WHERE client_id=?
      AND COALESCE(status,'')!='Annullato'
      AND (start_date IS NOT NULL OR end_date IS NOT NULL)
    ORDER BY COALESCE(start_date,'9999-12-31') ASC,id ASC
  `).bind(clientId).all()).results||[];

  if(!rows.length)return {start:null,end:null,hasOpenEnded:false};

  let start=null;
  let end=null;
  let hasOpenEnded=false;

  for(const row of rows){
    const s=monthOf(row.start_date);
    const e=monthOf(row.end_date);
    if(s && (!start || comparePeriods(s,start)<0))start=s;
    if(!row.end_date)hasOpenEnded=true;
    if(e && (!end || comparePeriods(e,end)>0))end=e;
  }

  // Se esiste un contratto senza data fine, il rapporto è considerato ancora aperto.
  if(hasOpenEnded)end=null;
  return {start,end,hasOpenEnded};
}

async function firstKnownPaymentPeriod(db,clientId){
  const row=await db.prepare(`
    SELECT COALESCE(period,substr(due_date,1,7),substr(paid_date,1,7)) AS p
    FROM payments
    WHERE client_id=?
      AND type='Canone'
      AND COALESCE(period,substr(due_date,1,7),substr(paid_date,1,7)) IS NOT NULL
    ORDER BY p ASC
    LIMIT 1
  `).bind(clientId).first();
  return row?.p||null;
}

async function ensureMonthlyPayment(db,client,period){
  // Se esiste già una rata manuale o automatica per quel cliente/mese, non ne crea un'altra.
  const existing=await db.prepare(`
    SELECT id,period,auto_generated,status,due_date,paid_date
    FROM payments
    WHERE client_id=?
      AND type='Canone'
      AND (
        period=? OR
        (period IS NULL AND substr(due_date,1,7)=?) OR
        (period IS NULL AND substr(paid_date,1,7)=?)
      )
    ORDER BY id ASC
    LIMIT 1
  `).bind(client.id,period,period,period).first();

  if(existing){
    // Normalizza i vecchi pagamenti manuali valorizzando il periodo, senza toccarne lo stato.
    if(!existing.period){
      await db.prepare(`UPDATE payments SET period=? WHERE id=?`).bind(period,existing.id).run();
    }
    return {created:false,existing:true,id:existing.id,status:existing.status};
  }

  const due=dueDateFor(period,client.billing_day||30);
  const today=new Date().toISOString().slice(0,10);
  const status=due<today ? 'Scaduto' : 'Da pagare';

  const result=await db.prepare(`
    INSERT INTO payments(
      client_id,type,amount,due_date,status,reference,period,auto_generated,notes
    ) VALUES(?,?,?,?,?,?,?,?,?)
  `).bind(
    client.id,
    'Canone',
    Number(client.monthly_value||0),
    due,
    status,
    `AUTO-${client.id}-${period}`,
    period,
    1,
    'Canone mensile generato automaticamente da EFFE OS in base al periodo contrattuale'
  ).run();

  return {created:true,existing:false,id:result.meta?.last_row_id||null,status};
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

  // Tutti i clienti con canone > 0 e automazione attiva vengono considerati,
  // anche se oggi risultano "Terminato" o "Pausa": lo storico dipende dalle date contratto.
  const clients=(await db.prepare(`
    SELECT id,name,monthly_value,start_date,end_date,created_at,
           auto_billing,billing_day,status
    FROM clients
    WHERE COALESCE(monthly_value,0)>0
      AND COALESCE(auto_billing,1)=1
    ORDER BY name ASC,id ASC
  `).all()).results||[];

  let created=0;
  let existing=0;
  let considered=0;
  const details=[];

  for(const client of clients){
    const contract=await contractRange(db,client.id);

    // PRIORITÀ DATA INIZIO:
    // 1. data inizio nella scheda cliente
    // 2. data inizio del contratto registrato
    // 3. prima mensilità già esistente
    // 4. data creazione cliente
    // 5. mese corrente
    let startPeriod=monthOf(client.start_date)
      || contract.start
      || await firstKnownPaymentPeriod(db,client.id)
      || monthOf(client.created_at)
      || nowPeriod;

    // PRIORITÀ DATA FINE:
    // 1. data fine nella scheda cliente
    // 2. data fine dell'ultimo contratto
    // Se non c'è data fine, il rapporto continua fino al mese corrente.
    let endContract=monthOf(client.end_date);
    if(!endContract)endContract=contract.end;

    // Mai creare rate future: al massimo fino al mese corrente.
    const endPeriod=endContract && comparePeriods(endContract,nowPeriod)<0
      ? endContract
      : nowPeriod;

    if(comparePeriods(startPeriod,nowPeriod)>0 || comparePeriods(startPeriod,endPeriod)>0){
      details.push({
        client_id:client.id,
        name:client.name,
        start_period:startPeriod,
        end_period:endPeriod,
        created:0,
        skipped:true,
        reason:'Il rapporto non comprende ancora il mese corrente o le date sono incoerenti'
      });
      continue;
    }

    // QUI È LA LOGICA CHIAVE:
    // genera/controlla OGNI singolo mese dall'inizio del rapporto fino a oggi
    // (o fino al mese di fine contratto, incluso).
    const periods=periodsBetween(startPeriod,endPeriod);
    let clientCreated=0;
    const clientMonths=[];

    for(const period of periods){
      const result=await ensureMonthlyPayment(db,client,period);
      if(result.created){
        created++;
        clientCreated++;
      }else{
        existing++;
      }
      clientMonths.push({period,created:result.created,status:result.status||null});
    }

    considered++;
    details.push({
      client_id:client.id,
      name:client.name,
      start_period:startPeriod,
      end_period:endPeriod,
      client_start_date:client.start_date||null,
      client_end_date:client.end_date||null,
      contract_start:contract.start,
      contract_end:contract.end,
      months_checked:periods.length,
      created:clientCreated,
      months:clientMonths
    });
  }

  // Sicurezza aggiuntiva per eventuali vecchi record ancora aperti.
  await db.prepare(`
    UPDATE payments
    SET status='Scaduto'
    WHERE status='Da pagare'
      AND due_date IS NOT NULL
      AND due_date<?
  `).bind(today).run();

  // Ogni pagamento confermato deve avere una sola entrata economica associata.
  const paid=(await db.prepare(`
    SELECT p.id,p.client_id,p.amount,p.paid_date,p.due_date,p.period,c.name AS client_name
    FROM payments p
    LEFT JOIN clients c ON c.id=p.client_id
    WHERE p.status='Pagato'
  `).all()).results||[];

  let transactionsCreated=0;
  for(const payment of paid){
    const transaction=await db.prepare(`
      SELECT id FROM transactions WHERE payment_id=? LIMIT 1
    `).bind(payment.id).first();
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
