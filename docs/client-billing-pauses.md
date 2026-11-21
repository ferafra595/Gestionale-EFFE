# EFFE OS — sospensione temporanea dei canoni cliente

## Motivazione
Un cliente può fermare temporaneamente un abbonamento mensile per uno o più mesi senza cessare il rapporto commerciale. EFFE non deve conteggiare il canone sospeso nel MRR del mese né presentarlo fra i pagamenti da incassare.

**Ambito:** canoni incassati dai clienti EFFE. Gli abbonamenti e le uscite pagati dall'agenzia (Canva, CapCut, ChatGPT) seguono un flusso separato e non vengono modificati.

## Utilizzo
1. Clienti → seleziona il cliente → Pacchetto.
2. Nella nuova sezione **Sospensioni canone** premi **Attiva gestione sospensioni** la prima volta. Viene creata esclusivamente la tabella `client_billing_pauses` con un indice.
3. Scegli **da mese** e **a mese incluso** (anche lo stesso mese); motivo facoltativo.
4. Premi **Sospendi canone** e conferma.
5. Le rate automatiche aperte di quei mesi vengono rimosse in modo controllato, non ricreate da `/api/payments/sync`; il MRR corrente e il valore di canone corrente nelle statistiche cliente sono ricalcolati al netto delle pause.
6. Il cliente resta attivo in anagrafica. Le sospensioni restano visibili nella scheda Pacchetto.
7. Premi **Riattiva** per rimuovere una sospensione in corso/futura. Il sistema sincronizza nuovamente i pagamenti e può ripristinare le rate del mese corrente e di eventuali mesi precedentemente non incassati.

## Garanzie
- Vengono gestiti solo periodi da **mese corrente in avanti**, per massimo 24 mesi.
- Non si possono creare periodi sovrapposti.
- Il salvataggio viene rifiutato se nei mesi selezionati esistono canoni già pagati, parzialmente pagati, pagamenti manuali non annullati o fatture emesse (data di emissione o scadenza nel mese).
- Le transazioni bancarie, le ricevute, le fatture emesse e i pagamenti storici già incassati **non sono cancellati né modificati**.
- Solo le rate **automatiche, non incassate e con stato Da pagare o Scaduto** possono essere eliminate; il vincolo è controllato anche nella query DELETE.
- `client_billing_pauses` è un archivio indipendente. La tabella `payments` non cambia schema.
- Il saldo residuo nei pagamenti e nelle scadenze è corretto dopo l'eliminazione delle rate automatiche aperte. Dashboard MRR, analytics MRR e briefing K.I.R.A. riflettono il canone sospeso.
- I report storici e gli incassi realmente registrati non vengono riscritti.
- La data di fine contratto non viene automaticamente prorogata. La proroga è una decisione contrattuale separata.

## Verifiche pre-rilascio / post-deploy
- Prima dell'attivazione, le API esistenti devono funzionare senza la tabella nuova.
- Cliente con canone 450 € e rata automatica non incassata in novembre: sospensione novembre deve eliminare solo la rata aperta e ridurre il MRR di 450 €; ricaricando Dashboard non devono apparire incassi da richiedere per quel mese.
- La successiva sincronizzazione pagamenti non deve ricreare la rata sospesa.
- Sospensione dicembre–gennaio: non devono essere create rate per dicembre e gennaio; ripresa da febbraio.
- Sospensione di un mese pagato/parzialmente pagato: blocco con errore, nessuna modifica ai dati.
- Riattivazione del mese corrente: sincronizzazione ricrea il canone previsto.
- Controllo accesso: API non autorizzate ricevono HTTP 401 dal middleware EFFE.
- Mobile: modulo mesi e pulsanti utilizzabili da smartphone.

## Limite attuale
Non viene modificato l'importo contrattuale nominale `clients.monthly_value`. I valori mostrati come **canone effettivo corrente** diventano zero durante la sospensione; lo storico e il valore nominale contrattuale restano consultabili. Le previsioni annuali teoriche possono essere diverse dagli incassi effettivi.

L'opzione di sospendere un singolo servizio anziché l'intero canone è uno sviluppo distinto.
