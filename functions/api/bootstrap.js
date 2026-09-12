async function columns(db, table){
  const r=await db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((r.results||[]).map(x=>String(x.name)));
}
async function addMissing(db, table, definitions){
  const have=await columns(db,table);
  const done=[];
  for(const [name,definition] of definitions){
    if(have.has(name)) continue;
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
    done.push(`${table}.${name}`);
  }
  return done;
}
export async function onRequestPost({env}){
  const db=env.DB;
  if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  try{
    const added=[];
    added.push(...await addMissing(db,'clients',[
      ['auto_billing','INTEGER DEFAULT 1'],['billing_day','INTEGER DEFAULT 30'],
      ['package_start_date','TEXT'],['package_end_date','TEXT']
    ]));
    added.push(...await addMissing(db,'leads', [['converted_client_id','INTEGER']]));
    added.push(...await addMissing(db,'payments', [['period','TEXT'],['auto_generated','INTEGER DEFAULT 0']]));
    added.push(...await addMissing(db,'transactions', [['client_id','INTEGER'],['payment_id','INTEGER']]));
    added.push(...await addMissing(db,'reports', [['social_results_json','TEXT']]));

    // Migrazione morbida: conserva i dati vecchi solo se i nuovi campi sono vuoti.
    await db.prepare(`UPDATE clients SET package_start_date=start_date WHERE package_start_date IS NULL AND start_date IS NOT NULL`).run();
    await db.prepare(`UPDATE clients SET package_end_date=end_date WHERE package_end_date IS NULL AND end_date IS NOT NULL`).run();
    await db.prepare(`UPDATE clients SET auto_billing=1 WHERE auto_billing IS NULL`).run();
    await db.prepare(`UPDATE clients SET billing_day=30 WHERE billing_day IS NULL OR billing_day<1 OR billing_day>31`).run();

    const indexes=[
      `CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status)`,
      `CREATE INDEX IF NOT EXISTS idx_clients_package_dates ON clients(package_start_date,package_end_date)`,
      `CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage)`,
      `CREATE INDEX IF NOT EXISTS idx_client_services_client_v10 ON client_services(client_id)`,
      `CREATE INDEX IF NOT EXISTS idx_payments_client_period_status ON payments(client_id,period,status)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_client_date ON transactions(client_id,date)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_payment ON transactions(payment_id) WHERE payment_id IS NOT NULL`
    ];
    for(const sql of indexes)await db.prepare(sql).run();
    return Response.json({ok:true,added});
  }catch(e){
    return Response.json({error:`Bootstrap database: ${e.message||e}`},{status:500});
  }
}
