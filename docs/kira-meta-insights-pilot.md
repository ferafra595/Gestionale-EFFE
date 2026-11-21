# EFFE — verifica Meta Insights (solo lettura)

## Stato del progetto
Questa fase aggiunge alla sezione Report una vista unica dello stato delle statistiche per tutti i clienti attivi. **Non genera né inventa metriche social**: evidenzia soltanto mesi con dati già registrati.

È inoltre presente un test opzionale con **un solo account Instagram professionale autorizzato**. Il test legge identificativo, username, follower e numero di media; **non importa report mensili**. Nessuna pubblicazione e nessuna scrittura su D1.

## Configurazione pilota Meta (soltanto quando pronta l'autorizzazione)
1. Creare/identificare una Meta App ufficiale da https://developers.facebook.com/apps/ .
2. Scegliere il percorso Instagram API with Facebook Login per il test implementato, con account Instagram Business/Creator collegato a una Pagina Facebook amministrata e con i permessi consentiti dall'app. Il percorso Instagram Login è differente e richiederà altro endpoint.
3. Usare l'ID **IG User** (non l'ID Facebook Page e non username testuale).
4. In Cloudflare Pages > progetto gestionale-effe > Settings > Variables and Secrets > **Production**, impostare:
   - `META_IG_USER_ID`: ID numerico dell'account IG professionale autorizzato.
   - `META_IG_ACCESS_TOKEN`: token di accesso Meta valido per l'account, salvato come **Secret**.
5. Non copiare token in chat, ticket, screenshot, README, GitHub o URL. Non fornire token di account cliente senza autorizzazione specifica. Disabilitare/rimuovere i segreti quando termina il test.
6. Dopo aver verificato le autorizzazioni e la distribuzione, aprire la sezione **Report** e cliccare su **Verifica collegamento Meta**.

Non servono queste variabili se si vuole utilizzare soltanto il nuovo riepilogo multi-cliente. Il pulsante restituirà «Account Meta non collegato» senza generare errori distruttivi.

## Protezioni
- Le richieste all'endpoint di verifica passano dalla sessione amministratore del gestionale.
- Il token rimane nel secret Cloudflare, non viene restituito al browser e non è salvato in D1.
- La chiamata HTTPS usa un header Authorization e versione Graph esplicita, con timeout breve.
- In caso di errore Meta la risposta contiene codice diagnostico generico, non le stringhe interne ricevute da Meta.
- Nessuna cancellazione o modifica di record, nessun programma ricorrente, nessun abbonamento.

## Per ottenere report social automatici veri
Restano necessari OAuth/autorizzazioni per ognuno dei clienti, accesso ai dati degli account Instagram e alle Pagine Facebook, una cache mensile D1 e una sincronizzazione periodica con gestione di errori e rate limits. Il test del solo conteggio follower non prova disponibilità o significato dei KPI mensili. L'accesso a clienti esterni ai ruoli dell'app può richiedere Business Verification e App Review.

Riferimenti:
- https://developers.facebook.com/docs/graph-api/reference/shadow-ig-user/insights/
- https://developers.facebook.com/docs/graph-api/reference/insights/
- https://developers.facebook.com/docs/insights/get-started
