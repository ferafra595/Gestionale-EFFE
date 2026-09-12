const iso=d=>d.toISOString().slice(0,10);
const addMonths=(date,months)=>{const d=new Date(date+'T00:00:00');const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+months);const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));return iso(d)};
const normalize=s=>String(s||'').trim().toLowerCase();
function intervalMonths(freq){const f=normalize(freq);if(f==='mensile')return 1;if(f==='trimestrale')return 3;if(f==='semestrale')return 6;if(f==='annuale')return 12;return 0}
function isOneTime(freq){return normalize(freq)==='una tantum'}
function isClosed(status){return /chius|disdett|annull|inattiv/.test(normalize(status))}
function occurrenceDates(start,freq,until){
  if(!start||!until||start>until)return [];
  if(isOneTime(freq))return [start];
  const step=intervalMonths(freq);if(!step)return [];
  const out=[];let d=start,guard=0;
  while(d<=until&&guard<240){out.push(d);d=addMonths(d,step);guard++}
  return out;
}
function annualCost(amount,freq){const a=Number(amount||0),f=normalize(freq);if(f==='mensile')return a*12;if(f==='trimestrale')return a*4;if(f==='semestrale')return a*2;if(f==='annuale'||f==='una tantum')return a;return 0}
function monthlyEquivalent(amount,freq){const annual=annualCost(amount,freq);return isOneTime(freq)?0:annual/12}
export async function onRequestPost({env}){
  const db=env.DB;if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  try{
    const today=iso(new Date()),month=today.slice(0,7);
    const {results:subs=[]}=await db.prepare(`SELECT * FROM subscriptions ORDER BY id`).all();
    let created=0,updated=0,removed=0;
    for(const s of subs){
      const start=(s.start_date||s.renewal_date||String(s.created_at||'').slice(0,10)||today);
      const closed=isClosed(s.status);
      const stop=closed?(s.closed_date||String(s.updated_at||'').slice(0,10)||today):today;
      const enabled=Number(s.auto_expense??1)===1;
      const dates=enabled?occurrenceDates(start,s.frequency,stop):[];
      const validKeys=new Set(dates.map(x=>x));
      for(const due of dates){
        if(due>today)continue;
        const existing=await db.prepare(`SELECT id,amount,date,description FROM transactions WHERE subscription_id=? AND subscription_period=? AND auto_generated=1 LIMIT 1`).bind(s.id,due).first();
        const desc=`Abbonamento ${s.name}${s.frequency?` · ${s.frequency}`:''}`;
        if(existing){
          if(Number(existing.amount)!==Number(s.amount||0)||existing.date!==due||existing.description!==desc){
            await db.prepare(`UPDATE transactions SET direction='Uscita',date=?,category='Abbonamenti',amount=?,description=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(due,Number(s.amount||0),desc,`Generato automaticamente da abbonamento #${s.id}`,existing.id).run();
            updated++;
          }
        }else{
          await db.prepare(`INSERT INTO transactions(client_id,payment_id,subscription_id,subscription_period,auto_generated,direction,date,category,amount,description,notes) VALUES(NULL,NULL,?,?,1,'Uscita',?,'Abbonamenti',?,?,?)`).bind(s.id,due,due,Number(s.amount||0),desc,`Generato automaticamente da abbonamento #${s.id}`).run();
          created++;
        }
      }
      const autoRows=(await db.prepare(`SELECT id,subscription_period FROM transactions WHERE subscription_id=? AND auto_generated=1`).bind(s.id).all()).results||[];
      for(const r of autoRows){if(!validKeys.has(String(r.subscription_period||''))){await db.prepare(`DELETE FROM transactions WHERE id=?`).bind(r.id).run();removed++}}
      let next=null;
      if(!closed&&enabled&&!isOneTime(s.frequency)){
        const step=intervalMonths(s.frequency);let d=start,guard=0;while(d<=today&&guard<240){d=addMonths(d,step);guard++}next=d;
      }
      if(!closed&&enabled&&isOneTime(s.frequency)&&start>today)next=start;
      await db.prepare(`UPDATE subscriptions SET start_date=COALESCE(start_date,?),renewal_date=?,updated_at=updated_at WHERE id=?`).bind(start,next,s.id).run();
    }
    const active=subs.filter(s=>!isClosed(s.status));
    const annual=active.reduce((sum,s)=>sum+annualCost(s.amount,s.frequency),0);
    const monthly=active.reduce((sum,s)=>sum+monthlyEquivalent(s.amount,s.frequency),0);
    const monthExpense=Number((await db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE direction='Uscita' AND category='Abbonamenti' AND substr(date,1,7)=?`).bind(month).first())?.v||0);
    return Response.json({ok:true,created,updated,removed,active:active.length,annualCost:annual,monthlyEquivalent:monthly,monthExpense});
  }catch(e){return Response.json({error:`Sync abbonamenti: ${e.message||e}`},{status:500})}
}
