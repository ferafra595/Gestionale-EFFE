# EFFE OS — Lettura diretta Meta Insights (fase pilota)

## Cosa funziona in questa fase
Nella pagina **Report** il riquadro **Instagram — dati live Meta (account pilota)** richiama
`GET /api/social/meta-insights` con la sessione amministratore del Gestionale EFFE.

Legge direttamente, senza servizi terzi:
- follower **attuali** e numero complessivo di media **attuale**;
- `views`, `reach` e `total_interactions` aggregati sul periodo richiesto;
- stato di ciascuna metrica, distinguendo zero reale da metrica non disponibile.

Non salva dati in D1, non pubblica post, non aggiorna gli 8 report dei clienti e non genera un report mensile definitivo. Non memorizza credenziali su GitHub, sul browser o nelle tabelle D1.

## Configurazione una tantum, sicura
1. **Revocare i token Meta che sono comparsi in screenshot o URL di debug.** Non riutilizzarli.
2. Ottenere un **token valido** per l'app EFFE Digital Strategy – Insights, con le autorizzazioni già testate (`instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`) e con il controllo dell'account Instagram Business/Creator.
3. Per la continuità automatica occorre un access token di tipo/durata adatti (long-lived user token oppure System User dove permesso). Il token generato da Graph API Explorer non basta per la sincronizzazione permanente; prevedere scadenza, rotazione e rinnovo. Non condividere mai un token in chat.
4. Cloudflare > Workers & Pages > **gestionale-effe** > **Settings > Variables and Secrets > Production**:
   - `META_IG_USER_ID` = ID numerico dell'account Instagram professionale che si vuole testare (esempio: account EFFE; non l'ID della Pagina).
   - `META_IG_ACCESS_TOKEN` = access token autorizzato, come **Secret cifrato**, mai variabile pubblica o file GitHub.
5. Salvare le impostazioni, effettuare il nuovo deployment Production necessario e aprire **Report**. Le statistiche del mese si caricano all'apertura; usare **Aggiorna statistiche** o selezionare un mese precedente per richiedere nuovamente i dati.

Se i secret non sono configurati, la pagina mostrerà un avviso senza errori distruttivi. Il test è visibile solo a utenti autenticati nel Gestionale.

## Endpoint
`GET /api/social/meta-insights?since=YYYY-MM-DD&until=YYYY-MM-DD`

- `until` è esclusivo, non comprende il giorno specificato.
- Intervalli massimi di 93 giorni; nessuna chiamata pubblica senza la sessione EFFE.
- Parametri di date convalide; il server usa `v27.0` Graph API.
- Meta riceve il token nell'header `Authorization`; non compare negli URL né nella risposta al browser.
- Errori Meta vengono normalizzati; nessun dump del corpo d'errore contenente dati sensibili.

## Limiti e prossima fase
Per **8 clienti** con portfolio separati servono autorizzazioni per ciascun account, procedure di OAuth/Meta Business verification e App Review secondo il ruolo e il livello di accesso. Un singolo token non autorizza automaticamente tutti i profili.

Questa è una **lettura su richiesta** direttamente dal gestionale, non ancora un job pianificato. Per acquisizione giornaliera autonoma e storico automatico servono:
- archivio D1 separato per account/periodo con acquisizioni idempotenti e provenienza dati;
- flusso di autorizzazione e rinnovo token multi-cliente;
- un Cloudflare Worker separato con **Cron Trigger**, dato che un progetto Pages Functions non espone direttamente lo scheduled handler Workers;
- costruzione report con etichette «dato attuale», «periodo», «non disponibile» e qualità della metrica.

Riferimenti ufficiali:
- https://developers.facebook.com/docs/graph-api/reference/shadow-ig-user/insights/
- https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/pages/functions/bindings/
