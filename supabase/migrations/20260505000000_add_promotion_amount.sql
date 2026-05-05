-- Add a generic promotion amount field that can be reused for any current promo.
-- Default 2160 corresponds to the Battery Promotion currently being offered.

ALTER TABLE business_params
  ADD COLUMN IF NOT EXISTS promotion_amount NUMERIC DEFAULT 2160;
