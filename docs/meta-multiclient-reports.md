# EFFE OS — Instagram Multi-Cliente, fase 1

## Obiettivo
La pagina **Report → Report Instagram — tutti i clienti** mostra un riepilogo unico degli account autorizzati, senza digitare follower, visualizzazioni, copertura e interazioni per ciascun cliente.

Questa fase si appoggia al token `META_IG_ACCESS_TOKEN` **già configurato in Cloudflare Production**. Non esporta né salva token in D1, in GitHub o nel browser. L’app Meta è stata verificata con KineoSal e con il profilo EFFE; gli altri account devono essere validati uno per uno dal recupero server-side.

## Attivazione
1. Accedere al Gestionale EFFE con la sessione amministratore.
2. Aprire **Report → Report Instagram — tutti i clienti**.
3. Cliccare **Attiva archivio Meta** una sola volta. Questo crea *soltanto* le due nuove tabelle D1 `social_meta_accounts` e `social_meta_months` (CREATE TABLE IF NOT EXISTS). Non modifica le tabelle esistenti dei clienti e i report precedenti.
4. Cliccare **Trova associazioni**. Il server usa `/me/accounts` (100 record massimo in questa fase) per individuare gli account Instagram associati alle Pagine Facebook accessibili. La lista proposta comprende **solo** nomi esatti o corrispondenze esplicitamente note: KineoSal, Maurizio Boutique, La Vesuviana, Schipani Auto, Ristorante Oasi. Verificare le proposte e confermare quelle corrette.
5. Per gli account autorizzati ma non riconosciuti automaticamente, utilizzare **Associa manualmente** per scegliere il cliente EFFE e il profilo Instagram dalla lista restituita direttamente da Meta. Il sistema richiede conferma esplicita e blocca la sostituzione di profili già collegati.
6. Cliccare **Aggiorna tutti i clienti collegati**. Recupera in una sola operazione le metriche di ciascun profilo e crea/aggiorna uno snapshot mensile indipendente.
7. **Esporta CSV** per scaricare i dati mensili di tutti i profili aggiornati con un solo pulsante.

## Provenienza, integrità e limiti
- Le metriche mensili Instagram (reach, views, total_interactions) vengono lette dalla risposta `insights?period=day&metric_type=total_value&since=...&until=...` e sono archiviate nel mese richiesto, con data di fine esclusiva.
- `followers_count` e `media_count` sono valori **attuali alla rilevazione**, non metriche storiche del mese.
- La reach viene archiviata direttamente come valore aggregato; non si somma la reach giornaliera.
- Il valore **0** è un valore esplicitamente fornito da Meta. Il valore **NULL** significa “non disponibile”.
- Per ogni account e mese esiste un solo snapshot (`UNIQUE(account_id, period)`); ripetere l’acquisizione aggiorna la stessa riga.
- Una risposta Meta non autorizzata o priva di metriche non cancella un precedente snapshot. L’associazione a un IG diverso è bloccata per evitare che dati storici vengano erroneamente attribuiti a un altro account.
- I report manuali esistenti (`reports` e `social_results_json`) non sono alterati.
- Le metriche Facebook non fanno ancora parte di questa fase.
- Aiello Eis Cafe, Psicologo Cisco e Antonio Lopreti non sono stati associati automaticamente perché non presenti tra gli account identificabili dal test condiviso. Per collegarli servono autorizzazioni e mapping verificati.
- Non c’è una sincronizzazione pianificata: l’aggiornamento è **un clic per tutti i clienti collegati**, non una compilazione per singolo account. Per un vero Cron giornaliero/mensile servirà un Worker dedicato con scheduler, più strategia di rinnovo token (non inclusi in questa fase).
- Il token Meta configurato su Cloudflare deve essere ruotato dopo esposizioni accidentali negli screenshot. Non inserirlo in chat.

## Sicurezza API
- Tutte le rotte nuove sono sotto `/api/social/manager` e richiedono la sessione EFFE tramite il middleware esistente.
- `GET ?action=status&month=YYYY-MM` elenca account associati e snapshot; non esegue modifiche.
- `GET ?action=suggest` controlla autorizzazioni Meta e propone associazioni.
- `POST {action:"setup"}` crea lo schema dedicato solo su richiesta esplicita.
- `POST {action:"auto_link",confirm:true,client_ids:[...]}` collega gli account selezionati dopo conferma.
- `POST {action:"sync",month:"YYYY-MM"}` legge Meta e salva gli snapshot per gli account associati.
- Le richieste Meta usano token nell'header Authorization, non nell'URL; redirects manuali, timeout 10s, senza inoltro di raw error bodies e senza log dei token.
- Per ciascuna sincronizzazione si leggono al massimo 15 account, a gruppi di 3.
