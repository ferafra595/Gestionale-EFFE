function socialBundle(row){try{const n=JSON.parse(row?.notes||'{}');if(n.kind==='social_package')return {posts:Number(n.posts||0),reels:Number(n.reels||0),stories:Number(n.stories||0)}}catch{}return null}
const n=v=>Number(v||0),today=()=>new Date().toISOString().slice(0,10);
function monthCountBetween(start,end){if(!start||!end||start>end)return 0;const sd=new Date(start+'T00:00:00'),ed=new Date(end+'T00:00:00');return Math.max(0,(ed.getFullYear()-sd.getFullYear())*12+ed.getMonth()-sd.getMonth()+1)}
function normalizePeriod(v){return String(v||'').trim().toLowerCase()}
function isOneTimeService(row){const p=normalizePeriod(row?.period);return ['once','one-time','one time','una tantum','progetto','project','singolo','single'].includes(p)}
function isCancelled(v){return /annull|cancel|perso/i.test(String(v||''))}
function recurringMonthsToYearEnd(start,end){
  if(!start)return 0;
  const y=new Date().getFullYear(),ys=`${y}-01-01`,ye=`${y}-12-31`;
  if(start>ye)return 0;
  let s=start<ys?ys:start,e=end&&end<ye?end:ye;
  if(e<ys||s>e)return 0;
  return monthCountBetween(s,e);
}
function oneTimeFallsInCurrentYear(date){
  if(!date)return false;
  const y=String(new Date().getFullYear());
  return String(date).slice(0,4)===y;
}
export async function onRequestGet({env}){
  const db=env.DB;if(!db)return Response.json({error:'Binding D1 DB mancante'},{status:500});
  const [cr,sr,ir,pr,tr,cor,lr,er,pjr]=await db.batch([
    db.prepare(`SELECT * FROM clients ORDER BY CASE WHEN status='Attivo' THEN 0 ELSE 1 END,name`),
    db.prepare(`SELECT cs.*,s.name service_name FROM client_services cs LEFT JOIN services s ON s.id=cs.service_id`),
    db.prepare(`SELECT * FROM invoices`),db.prepare(`SELECT * FROM payments`),db.prepare(`SELECT * FROM transactions`),db.prepare(`SELECT * FROM contracts`),
    db.prepare(`SELECT COUNT(*) v FROM leads`),db.prepare(`SELECT COALESCE(SUM(purchase_cost),0) v FROM equipment`),db.prepare(`SELECT * FROM projects`)
  ]);
  const clients=cr.results||[],services=sr.results||[],invoices=ir.results||[],payments=pr.results||[],transactions=tr.results||[],contracts=cor.results||[],projects=pjr.results||[];
  const clientStats=clients.map(c=>{
    const cid=String(c.id),sv=services.filter(x=>String(x.client_id)===cid),social=socialBundle(sv.find(socialBundle))||{posts:0,reels:0,stories:0},inv=invoices.filter(x=>String(x.client_id)===cid),pp=payments.filter(x=>String(x.client_id)===cid),tx=transactions.filter(x=>String(x.client_id)===cid),ct=contracts.filter(x=>String(x.client_id)===cid&&x.end_date).sort((a,b)=>String(a.end_date).localeCompare(String(b.end_date)))[0];
    const clientProjects=projects.filter(x=>String(x.client_id)===cid&&!isCancelled(x.status));
    const oneTimeServices=sv.filter(isOneTimeService);
    const oneTimeServicesValue=oneTimeServices.reduce((s,x)=>s+n(x.price)*Math.max(1,n(x.quantity)||1),0);
    const projectValue=clientProjects.reduce((s,x)=>s+n(x.value),0);
    const oneTimeValue=oneTimeServicesValue+projectValue;
    const income=tx.filter(x=>x.direction==='Entrata').reduce((s,x)=>s+n(x.amount),0),expense=tx.filter(x=>x.direction==='Uscita').reduce((s,x)=>s+n(x.amount),0),pkgStart=c.package_start_date||'',pkgEnd=c.package_end_date||'';
    // Valore 12 mesi: ogni canone mensile viene annualizzato per 12 mesi dalla sua partenza,
    // indipendentemente dal mese del calendario. I lavori una tantum entrano una sola volta.
    const recurring12=n(c.monthly_value)*12;
    const twelveMonthValue=recurring12+oneTimeValue;
    // Valore fino al 31/12: solo le mensilità che ricadono nell'anno corrente,
    // dalla data di inizio del pacchetto (o dal 1/1 se iniziato prima), rispettando un'eventuale fine anticipata.
    const monthsToYearEnd=recurringMonthsToYearEnd(pkgStart,pkgEnd);
    const recurringToYearEnd=n(c.monthly_value)*monthsToYearEnd;
    // Una tantum: i servizi senza data propria usano la data inizio pacchetto; i progetti usano start_date/deadline/created_at.
    const oneTimeServicesThisYear=(pkgStart&&oneTimeFallsInCurrentYear(pkgStart))?oneTimeServicesValue:0;
    const projectsThisYear=clientProjects.filter(p=>oneTimeFallsInCurrentYear(p.start_date||p.deadline||p.created_at)).reduce((s,x)=>s+n(x.value),0);
    const yearEndValue=recurringToYearEnd+oneTimeServicesThisYear+projectsThisYear;
    const monthly=[];for(let i=11;i>=0;i--){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-i);const mk=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,mm=tx.filter(x=>String(x.date||'').slice(0,7)===mk);monthly.push({month:mk,revenue:mm.filter(x=>x.direction==='Entrata').reduce((s,x)=>s+n(x.amount),0),expense:mm.filter(x=>x.direction==='Uscita').reduce((s,x)=>s+n(x.amount),0)})}
    return {id:c.id,name:c.name,status:c.status,relationship_type:c.relationship_type||'',packageStart:pkgStart,packageEnd:pkgEnd,monthlyValue:n(c.monthly_value),annualRecurring:twelveMonthValue,remainingYearValue:yearEndValue,fullYearValue:recurring12,oneTimeValue,projectValue,oneTimeServicesValue,monthsToYearEnd,recurringToYearEnd,invoiceIssued:inv.reduce((s,x)=>s+n(x.total),0),invoicePaid:inv.filter(x=>/pagata/i.test(x.status||'')).reduce((s,x)=>s+n(x.total),0),invoiceOutstanding:inv.filter(x=>!/pagata|annullata/i.test(x.status||'')).reduce((s,x)=>s+n(x.total),0),paymentsPaid:pp.filter(x=>/pagat/i.test(x.status||'')).reduce((s,x)=>s+n(x.amount),0),paymentsPending:pp.filter(x=>!/pagat|annull/i.test(x.status||'')).reduce((s,x)=>s+n(x.amount),0),overduePayments:pp.filter(x=>!/pagat|annull/i.test(x.status||'')&&x.due_date&&x.due_date<today()).reduce((s,x)=>s+n(x.amount),0),actualIncome:income,actualExpense:expense,netActual:income-expense,social:{...social,total:social.posts+social.reels+social.stories},contractEnd:ct?.end_date||'',services:sv.map(x=>x.custom_name||x.service_name||'Servizio').filter(Boolean),monthly};
  });
  const active=clients.filter(c=>c.status==='Attivo'),mrr=active.reduce((s,c)=>s+n(c.monthly_value),0),actualIncome=transactions.filter(x=>x.direction==='Entrata').reduce((s,x)=>s+n(x.amount),0),actualExpense=transactions.filter(x=>x.direction==='Uscita').reduce((s,x)=>s+n(x.amount),0),activeStats=clientStats.filter(x=>x.status==='Attivo');
  return Response.json({
    activeClients:active.length,totalClients:clients.length,mrr,
    annualProjection:activeStats.reduce((s,x)=>s+x.annualRecurring,0),
    remainingYearProjection:activeStats.reduce((s,x)=>s+x.remainingYearValue,0),
    oneTimeProjection:activeStats.reduce((s,x)=>s+x.oneTimeValue,0),
    actualIncome,actualExpense,actualNet:actualIncome-actualExpense,
    leads:Number(lr.results?.[0]?.v||0),equipmentValue:Number(er.results?.[0]?.v||0),clientStats
  });
}
