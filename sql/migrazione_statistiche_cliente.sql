-- Esegui UNA SOLA VOLTA nella Console D1 di Cloudflare.
-- Aggiunge il collegamento facoltativo Cliente ai movimenti Entrate/Uscite.
ALTER TABLE transactions ADD COLUMN client_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_transactions_client ON transactions(client_id);
