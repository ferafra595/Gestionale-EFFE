// EFFE OS — Export dati di lavorazione per l'admin autenticato.
// Il middleware comune controlla il cookie HttpOnly. Solo GET.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0',
  'X-Content-Type-Options':'nosniff'
}});
export async function onRequestGet({env}){
  if(!env.DB)return json({error:'Binding D1 DB mancante'},503);
  try{
    const [taskRows,contentRows]=await env.DB.batch([
      env.DB.prepare(`SELECT t.id,t.title,t.priority,t.status,t.due_date,c.name AS client_name
         FROM tasks t LEFT JOIN clients c ON c.id=t.client_id
         WHERE lower(trim(COALESCE(t.status,''))) NOT IN ('completato','completata','annullato','annullata','archiviato')
         ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,t.due_date,t.id DESC LIMIT 50`),
      env.DB.prepare(`SELECT ct.id,ct.title,ct.type,ct.status,ct.date,c.name AS client_name
         FROM content ct LEFT JOIN clients c ON c.id=ct.client_id
         WHERE lower(trim(COALESCE(ct.status,''))) NOT IN ('completato','completata','annullato','annullata','pubblicato')
         ORDER BY CASE WHEN ct.date IS NULL THEN 1 ELSE 0 END,ct.date,ct.id DESC LIMIT 50`)
    ]);
    return json({tasks:taskRows.results||[],content:contentRows.results||[]});
  }catch(_){return json({error:'Errore durante la lettura del briefing'},500);}
}
export async function onRequest(){return json({error:'Metodo non consentito'},405);}
