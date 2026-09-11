-- Eseguire UNA SOLA VOLTA nella Console D1
ALTER TABLE clients ADD COLUMN auto_billing INTEGER DEFAULT 1;
ALTER TABLE clients ADD COLUMN billing_day INTEGER DEFAULT 30;
ALTER TABLE payments ADD COLUMN period TEXT;
ALTER TABLE payments ADD COLUMN auto_generated INTEGER DEFAULT 0;
ALTER TABLE transactions ADD COLUMN payment_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_auto_period
ON payments(client_id, period, type)
WHERE auto_generated=1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_payment
ON transactions(payment_id)
WHERE payment_id IS NOT NULL;

-- Imposta automaticamente a 30 il giorno di scadenza dei clienti esistenti.
UPDATE clients SET auto_billing=1 WHERE auto_billing IS NULL;
UPDATE clients SET billing_day=30 WHERE billing_day IS NULL;
