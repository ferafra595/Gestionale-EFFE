function parseSocial(row){try{const n=JSON.parse(row?.notes||'{}');if(n.kind==='social_package')return {posts:Number(n.posts||0),reels:Number(n.reels||0),stories:Number(n.stories||0)}}catch{}return null}
function weight(name,qty){const n=String(name||'').toLowerCase(),q=Number(qty||1);if(n.includes('shoot'))return 4*q;if(n.includes('branding'))return 5*q;if(n.includes('newsletter'))return 2*q;if(n.includes('automaz'))return 4*q;return q}
const LOW_MAX=3.5,MEDIUM_MAX=6,WEIGHTS={post:1,reel:2,story:.25};
export async function onRequestGet({env}){
  const db=env.DB,now=new Date().toISOString().slice(0,10),in30=new Date(Date.now()+30*864e5).toISOString().slice(0,10);
  const [cr,sr,or_,pr,lr]=await db.batch([
    db.prepare(`SELECT id,name,monthly_value,package_start_date,package_end_date FROM clients WHERE status='Attivo' ORDER BY monthly_value DESC`),
    db.prepare(`SELECT cs.*,s.name service_name FROM client_services cs LEFT JOIN services s ON s.id=cs.service_id`),
    db.prepare(`SELECT COUNT(*) v FROM payments WHERE status='Scaduto' OR (status='Da pagare' AND due_date<?)`).bind(now),
    db.prepare(`SELECT COUNT(*) v FROM clients WHERE package_end_date BETWEEN ? AND ?`).bind(now,in30),
    db.prepare(`SELECT COUNT(*) v FROM leads WHERE COALESCE(stage,'') NOT IN ('Cliente','Perso')`)
  ]);
  const clients=cr.results||[],services=sr.results||[];let social={posts:0,reels:0,stories:0,total:0};
  const mapped=clients.map(c=>{const rows=services.filter(r=>String(r.client_id)===String(c.id));let posts=0,reels=0,stories=0,points=0,extras=[];for(const r of rows){const sb=parseSocial(r);if(sb){posts+=sb.posts;reels+=sb.reels;stories+=sb.stories;points+=sb.posts*WEIGHTS.post+sb.reels*WEIGHTS.reel+sb.stories*WEIGHTS.story}else{const name=r.custom_name||r.service_name||'Servizio';extras.push(name);points+=weight(name,r.quantity)}}social.posts+=posts;social.reels+=reels;social.stories+=stories;const value=Number(c.monthly_value||0),pressure=points/(Math.max(value,1)/100),risk=pressure>MEDIUM_MAX?'Alto':pressure>LOW_MAX?'Medio':'Basso',score=Math.max(8,Math.min(100,pressure*12)),bits=[];if(posts)bits.push(`${posts} Post`);if(reels)bits.push(`${reels} Reel`);if(stories)bits.push(`${stories} Storie`);if(extras.length)bits.push(extras.slice(0,2).join(' + '));return {...c,score,risk,pressure:Number(pressure.toFixed(2)),summary:bits.join(' · ')||'Nessun servizio configurato'}});
  social.total=social.posts+social.reels+social.stories;
  return Response.json({clients:mapped,overdue:Number(or_.results?.[0]?.v||0),packages30:Number(pr.results?.[0]?.v||0),openLeads:Number(lr.results?.[0]?.v||0),social,guide:{lowMax:LOW_MAX,mediumMax:MEDIUM_MAX,weights:WEIGHTS}});
}
