# EFFE OS
Gestionale interno premium per EFFE Digital Strategy.

## Stack
- Cloudflare Pages
- Cloudflare Pages Functions
- Cloudflare D1
- Cloudflare R2
- HTML + CSS + JavaScript vanilla
- GitHub

## 1. Crea repository GitHub
Carica tutto il contenuto di questa cartella nella root del repository.

## 2. Crea database D1
Cloudflare > Storage & Databases > D1 > Create database
Nome consigliato: `effe-os-db`.

Esegui `sql/schema.sql` nella console D1.

## 3. Crea bucket R2
Cloudflare > R2 > Create bucket
Nome consigliato: `effe-os-files`.

## 4. Crea progetto Cloudflare Pages
Collega il repository GitHub.
Build command: lascia vuoto.
Build output directory: `/` oppure `.` a seconda dell'interfaccia Pages.

## 5. Binding
Nel progetto Pages > Settings > Bindings:
- D1 database binding: `DB` -> effe-os-db
- R2 bucket binding: `BUCKET` -> effe-os-files

## 6. Variabili ambiente
Pages > Settings > Variables and Secrets:
- `ADMIN_PASSWORD` = password scelta da te
- `SESSION_SECRET` = stringa lunga casuale (almeno 32 caratteri)

Imposta entrambe come secret in produzione.

## 7. Deploy
Esegui un nuovo deploy dopo aver aggiunto binding e variabili.

## Funzioni incluse
- Login admin singolo con cookie HttpOnly
- Dashboard agenzia
- CRM Lead
- Clienti
- Progetti
- Task
- Calendario editoriale
- ADS manuali
- Siti / rinnovi
- Servizi EFFE
- Preventivi premium con anteprima e stampa/salvataggio PDF
- Contratti
- Fatture
- Pagamenti
- Entrate / Uscite
- Abbonamenti
- Attrezzatura
- Documenti R2
- Report
- Statistiche
- Controllo Agenzia
- Ricerca globale
- Impostazioni

## Nota pacchetti cliente
La tabella `client_services` è già predisposta per i deliverable personalizzati. La V1 usa questi dati nelle statistiche/Control. Per inserire pacchetti dettagliati via interfaccia può essere aggiunta una tab dedicata nella scheda cliente senza cambiare il database.

## Sicurezza
Non memorizzare password dei clienti nel gestionale. La password admin è una variabile segreta Cloudflare e non è salvata nel repository.
