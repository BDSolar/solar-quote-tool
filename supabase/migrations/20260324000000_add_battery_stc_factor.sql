-- Add battery_stc_factor column alongside existing battery_rebate_per_kwh
-- New code reads battery_stc_factor; old column kept for backward compat
ALTER TABLE business_params ADD COLUMN IF NOT EXISTS battery_stc_factor DECIMAL DEFAULT 8.4;
UPDATE business_params SET battery_stc_factor = 8.4 WHERE battery_stc_factor IS NULL;
