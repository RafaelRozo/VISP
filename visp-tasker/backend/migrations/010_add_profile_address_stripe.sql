-- Migration: Add default address and Stripe customer ID to users table
-- Corresponds to user.py model changes for customer profile enhancements

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_address_street    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS default_address_city      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS default_address_province  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS default_address_postal_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS default_address_country   VARCHAR(5) DEFAULT 'CA',
  ADD COLUMN IF NOT EXISTS default_address_latitude   NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS default_address_longitude  NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS default_address_formatted  VARCHAR(500),
  ADD COLUMN IF NOT EXISTS stripe_customer_id         VARCHAR(255);
