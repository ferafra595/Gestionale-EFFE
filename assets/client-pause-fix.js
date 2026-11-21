// Robust replacement for the package pause panel until the main bundle can be rebuilt.
// No changes to financial records are made on page load.
(function(){
  async function req(url,body){
    const r=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',
      headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined,cache:'no-store'});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(data.error||'Richiesta non riuscita (HTTP '+r.status+')');
    return data;
  }
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function pausePanel(client){
    const parent=document.querySelector('#savePackagePeriod')?.closest('.social-pack-card');
    if(!parent)return;
    let panel=document.querySelector('#clientPausePanel');
    if(!panel){panel=document.createElement('div');panel.id='clientPausePanel';panel.className='social-pack-card';panel.style.marginTop='16px';parent.after(panel)}
    panel.textContent='Caricamento sospensioni…';
    const url='/api/clients/'+encodeURIComponent(client.id)+'/pauses';
    try{
      const data=await req(url),month=data.current_month||new Date().toISOString().slice(0,7);
      if(!panel.isConnected)return;
      const head='<div class="social-pack-head"><div><div class="eyebrow">SOSPENSIONI CANONE</div><h3>Sospendi il canone per uno o più mesi</h3><p class="small muted">Nessuna rata automatica nei mesi sospesi. Incassi e fatture emesse non vengono modificati.</p></div></div>';
      if(!data.initialized){
        panel.innerHTML=head+'<button type="button" class="btn btn-primary" id="initClientPauses">Attiva gestione sospensioni</button>';
        const b=panel.querySelector('#initClientPauses');
        b.onclick=async()=>{b.disabled=true;try{await req(url,{action:'setup'});await pausePanel(client)}catch(e){b.disabled=false;show(e.message)}};
        return;
      }
      const rows=(data.pauses||[]).map(p=>'<div class="metric-row" style="padding:10px 0;align-items:center;justify-content:space-between"><div><strong>'+esc(p.start_month)+' → '+esc(p.end_month)+'</strong><div class="small muted">'+esc(p.reason||'Canone sospeso')+'</div></div>'+(p.end_month>=month?'<button type="button" class="btn btn-ghost resumePause" data-id="'+Number(p.id)+'">Riattiva</button>':'<span class="small muted">Conclusa</span>')+'</div>').join('');
      panel.innerHTML=head+'<div class="form-grid"><div class="field"><label>Da mese</label><input class="input" type="month" id="pauseStartNew" min="'+esc(month)+'" value="'+esc(month)+'"></div><div class="field"><label>A mese incluso</label><input class="input" type="month" id="pauseEndNew" min="'+esc(month)+'" value="'+esc(month)+'"></div><div class="field span-2"><label>Motivo (facoltativo)</label><input class="input" id="pauseReasonNew" maxlength="200"></div></div><div class="social-pack-foot"><span class="small muted">Le rate pagate, gli acconti e le fatture emesse sono protetti.</span><button type="button" class="btn btn-primary" id="pauseCreateNew">Sospendi canone</button></div><div style="margin-top:14px">'+(rows||'<p class="small muted">Nessuna sospensione registrata.</p>')+'</div><p id="pauseStatus" class="small muted" role="status"></p>';
      const msg=t=>{const el=panel.querySelector('#pauseStatus');if(el)el.textContent=t};
      panel.querySelector('#pauseCreateNew').onclick=async function(){
        const start=panel.querySelector('#pauseStartNew').value,end=panel.querySelector('#pauseEndNew').value;
        if(!start||!end||start>end){msg('Seleziona un periodo valido.');return}
        if(!confirm('Sospendere il canone da '+start+' a '+end+'? Le rate automatiche aperte saranno rimosse.'))return;
        this.disabled=true;msg('Salvataggio sospensione…');
        try{
          await req(url,{action:'pause',start_month:start,end_month:end,reason:panel.querySelector('#pauseReasonNew').value});
          await req('/api/payments/sync',{});await pausePanel(client);if(typeof clearApiCache==='function')clearApiCache();
        }catch(e){this.disabled=false;msg('Impossibile sospendere: '+e.message)}
      };
      panel.querySelectorAll('.resumePause').forEach(button=>button.onclick=async()=>{
        if(!confirm('Riattivare il canone? Le rate automatiche potranno essere rigenerate.'))return;
        button.disabled=true;msg('Riattivazione in corso…');
        try{await req(url,{action:'resume',pause_id:Number(button.dataset.id)});await req('/api/payments/sync',{});await pausePanel(client);if(typeof clearApiCache==='function')clearApiCache()}
        catch(e){button.disabled=false;msg('Impossibile riattivare: '+e.message)}
      });
    }catch(e){panel.textContent='Errore lettura sospensioni: '+e.message}
  }
  function show(msg){const panel=document.querySelector('#clientPausePanel');if(panel)panel.textContent=msg}
  window.renderClientPausePanel=pausePanel;
})();