-- Add install_period column to business_params
-- Admin selects the install period; deeming and factor are derived from schedules
ALTER TABLE business_params ADD COLUMN IF NOT EXISTS install_period TEXT DEFAULT '2026-01';
UPDATE business_params SET install_period = '2026-01' WHERE install_period IS NULL;
