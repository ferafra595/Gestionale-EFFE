-- ESEGUIRE UNA SOLA VOLTA nella console D1
ALTER TABLE clients ADD COLUMN package_start_date TEXT;
ALTER TABLE clients ADD COLUMN package_end_date TEXT;
ALTER TABLE leads ADD COLUMN converted_client_id INTEGER;

-- Mantiene compatibili tutti i clienti già esistenti.
UPDATE clients SET package_start_date=start_date WHERE package_start_date IS NULL AND start_date IS NOT NULL;
UPDATE clients SET package_end_date=end_date WHERE package_end_date IS NULL AND end_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_package_dates ON clients(package_start_date,package_end_date);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_client_services_client_v10 ON client_services(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_client_period_status ON payments(client_id,period,status);
CREATE INDEX IF NOT EXISTS idx_transactions_client_date ON transactions(client_id,date);
