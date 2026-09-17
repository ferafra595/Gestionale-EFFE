const TABLES={
  client_services:['client_id','service_id','custom_name','quantity','period','price','notes'],
  clients:['name','contact_name','phone','email','address','vat','status','relationship_type','monthly_value','source','auto_billing','billing_day','package_start_date','package_end_date','notes'],
  leads:['name','contact_name','phone','email','source','service_interest','stage','expected_value','probability','next_contact','notes','converted_client_id'],
  services:['name','category','indicative_price','internal_cost','unit','description'],
  quotes:['client_id','issue_date','title','status','valid_until','introduction','objectives','strategy','items_json','total','duration','payment_terms','conditions'],
  contracts:['client_id','title','type','status','value','start_date','end_date','payment_terms','body'],
  invoices:['client_id','number','issue_date','due_date','subtotal','vat_rate','total','status','payment_date','payment_method','notes'],
  payments:['client_id','type','amount','due_date','paid_date','status','method','reference','period','auto_generated','notes'],
  transactions:['client_id','payment_id','direction','date','category','amount','description','notes'],
  subscriptions:['name','category','amount','frequency','start_date','renewal_date','status','closed_date','auto_expense','notes'],
  equipment:['name','category','purchase_cost','purchase_date','warranty_end','serial','status','notes'],
  reports:['client_id','title','period','followers','reach','views','interactions','contents','ad_spend','leads','cpl','worked','wins','improve','next_strategy','social_results_json'],
  documents:['client_id','name','category','storage_key','created_date'],
  appointments:['client_id','title','appointment_date','start_time','end_time','type','status','location','phone','notes']
};

export async function onRequest({request,env,params}){
  if(!env.DB)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  const parts=(params.path||[]),table=parts[0],id=parts[1];
  if(!TABLES[table])return Response.json({error:'Risorsa non valida'},{status:404});
  if(request.method==='GET')return list(env.DB,table);
  if(request.method==='POST'&&!id)return create(request,env.DB,table);
  if(request.method==='PUT'&&id)return update(request,env.DB,table,id);
  if(request.method==='DELETE'&&id)return remove(env.DB,table,id);
  return Response.json({error:'Metodo non supportato'},{status:405});
}

async function list(db,t){
  let sql=`SELECT ${t}.*`;
  if(TABLES[t].includes('client_id'))sql+=`, clients.name AS client_name, clients.status AS client_status`;
  sql+=` FROM ${t}`;
  if(TABLES[t].includes('client_id'))sql+=` LEFT JOIN clients ON clients.id=${t}.client_id`;
  sql+=` ORDER BY ${orderField(t)} DESC`;
  const {results}=await db.prepare(sql).all();
  return Response.json({items:results||[]});
}

function orderField(t){return ({payments:'due_date',invoices:'issue_date',transactions:'date',quotes:'issue_date',reports:'period',appointments:'appointment_date'}[t]||'id')}

async function create(req,db,t){
  const data=await req.json();
  if(t==='subscriptions'){
    if(!data.start_date)data.start_date=new Date().toISOString().slice(0,10);
    if(data.auto_expense===undefined)data.auto_expense=1;
    if(/chius|disdett|annull/i.test(String(data.status||''))&&!data.closed_date)data.closed_date=new Date().toISOString().slice(0,10);
  }
  const cols=TABLES[t].filter(k=>data[k]!==undefined),vals=cols.map(k=>normalize(data[k]));
  if(!cols.length)return Response.json({error:'Nessun dato'},{status:400});
  const q=`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`;
  const r=await db.prepare(q).bind(...vals).run();
  const id=r.meta.last_row_id;
  let converted_client_id=null;
  if(t==='leads')converted_client_id=await convertLeadIfNeeded(db,id);
  return Response.json({ok:true,id,converted_client_id});
}

async function update(req,db,t,id){
  const data=await req.json();
  if(t==='subscriptions'){
    if(/chius|disdett|annull/i.test(String(data.status||''))&&!data.closed_date)data.closed_date=new Date().toISOString().slice(0,10);
    if(String(data.status||'').toLowerCase()==='attivo')data.closed_date=null;
  }
  const cols=TABLES[t].filter(k=>data[k]!==undefined);
  if(!cols.length)return Response.json({error:'Nessun dato'},{status:400});
  const q=`UPDATE ${t} SET ${cols.map(k=>`${k}=?`).join(',')}, updated_at=CURRENT_TIMESTAMP WHERE id=?`;
  await db.prepare(q).bind(...cols.map(k=>normalize(data[k])),id).run();
  let converted_client_id=null;
  if(t==='leads')converted_client_id=await convertLeadIfNeeded(db,id);
  return Response.json({ok:true,converted_client_id});
}

async function convertLeadIfNeeded(db,id){
  const lead=await db.prepare(`SELECT * FROM leads WHERE id=?`).bind(id).first();
  if(!lead || String(lead.stage||'').toLowerCase()!=='cliente')return lead?.converted_client_id||null;
  if(lead.converted_client_id)return lead.converted_client_id;

  let existing=null;
  if(lead.email)existing=await db.prepare(`SELECT id FROM clients WHERE lower(email)=lower(?) LIMIT 1`).bind(lead.email).first();
  if(!existing && lead.phone)existing=await db.prepare(`SELECT id FROM clients WHERE phone=? LIMIT 1`).bind(lead.phone).first();
  if(!existing && lead.name)existing=await db.prepare(`SELECT id FROM clients WHERE lower(name)=lower(?) LIMIT 1`).bind(lead.name).first();

  let clientId=existing?.id||null;
  if(!clientId){
    const r=await db.prepare(`
      INSERT INTO clients(name,contact_name,phone,email,status,relationship_type,monthly_value,source,auto_billing,billing_day,notes)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      lead.name,lead.contact_name||null,lead.phone||null,lead.email||null,
      'Attivo','Da definire',0,lead.source||null,1,30,
      lead.notes?`Creato automaticamente da Lead #${lead.id}. ${lead.notes}`:`Creato automaticamente da Lead #${lead.id}`
    ).run();
    clientId=r.meta.last_row_id;
  }
  await db.prepare(`UPDATE leads SET converted_client_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(clientId,id).run();
  return clientId;
}

async function remove(db,t,id){
  if(t==='payments'){try{await db.prepare('DELETE FROM transactions WHERE payment_id=?').bind(id).run()}catch{}}
  await db.prepare(`DELETE FROM ${t} WHERE id=?`).bind(id).run();
  return Response.json({ok:true});
}
function normalize(v){return v===''?null:v}
