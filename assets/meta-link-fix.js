// Fix isolato per il collegamento in blocco degli account Instagram.
// Gestore in fase capture: corregge il vecchio onclick prima che possa usare querySelector(...).map().
(function(){
  'use strict';
  document.addEventListener('click',async function(event){
    const button=event.target?.closest?.('#metaMultiApply');
    if(!button)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if(button.disabled)return;
    const status=document.querySelector('#metaMultiSuggestionArea');
    const selected=Array.from(document.querySelectorAll('.metaLinkChoice:checked'))
      .map(el=>Number(el.value)).filter(Number.isSafeInteger);
    if(!selected.length){
      if(status){const note=document.createElement('p');note.textContent='Seleziona almeno un account prima di collegarlo.';status.append(note)}
      return;
    }
    if(!window.confirm('Confermi l’associazione di '+selected.length+' account Instagram ai clienti EFFE?'))return;
    const original=button.textContent;
    button.disabled=true;
    button.textContent='Collegamento in corso…';
    const feedback=document.createElement('p');
    feedback.id='metaLinkFeedback';
    feedback.style.marginTop='12px';
    feedback.setAttribute('role','status');
    feedback.textContent='Verifico le associazioni con Meta…';
    if(status){status.querySelector('#metaLinkFeedback')?.remove();status.append(feedback)}
    try{
      const response=await fetch('/api/social/manager',{method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({action:'auto_link',confirm:true,client_ids:selected})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'Errore HTTP '+response.status);
      const linked=Array.isArray(data.linked)?data.linked:[];
      if(linked.length===0)throw new Error('Nessun account è stato collegato. Ricarica le associazioni e riprova.');
      feedback.textContent=linked.length+' account collegati correttamente. Aggiorno la tabella…';
      // navigate è la funzione già presente in assets/app.js: esegue un nuovo GET dello stato D1.
      if(typeof navigate==='function')navigate('reports');
      else window.location.reload();
    }catch(error){
      feedback.textContent='Collegamento non riuscito: '+String(error.message||error);
      button.disabled=false;
      button.textContent=original;
    }
  },true);
})();
