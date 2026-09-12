export async function onRequestGet({request,env}){
  const q=(new URL(request.url).searchParams.get('q')||'').trim();if(q.length<2)return Response.json({items:[]});const like=`%${q}%`,items=[];
  const sets=[['clients','clients','Cliente','name','email'],['leads','leads','Lead','name','service_interest'],['quotes','quotes','Preventivo','title','status'],['contracts','contracts','Contratto','title','status'],['invoices','invoices','Fattura','number','status']];
  const rows=await Promise.all(sets.map(async([t,p,type,a,b])=>{const r=(await env.DB.prepare(`SELECT id,${a} title,${b} subtitle FROM ${t} WHERE ${a} LIKE ? OR ${b} LIKE ? LIMIT 5`).bind(like,like).all()).results||[];return r.map(x=>({...x,page:p,type}))}));
  rows.forEach(r=>items.push(...r));return Response.json({items:items.slice(0,20)});
}
