-- Schema Cleanup Migration
-- All table renames use ALTER TABLE RENAME (no data loss)
-- All column renames use ALTER TABLE RENAME COLUMN (no data loss)

-- ============================================================================
-- 0. Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pg_trgm" SCHEMA "extensions";

-- ============================================================================
-- 1. Drop redundant indexes (before table renames)
-- ============================================================================

-- Estimate: redundant indexes covered by compound indexes
DROP INDEX IF EXISTS "idx_estimates_source";
DROP INDEX IF EXISTS "idx_estimates_start_date";
DROP INDEX IF EXISTS "idx_estimates_status_manual";
DROP INDEX IF EXISTS "idx_estimates_user_id";

-- Item: duplicate [type] index (line 128 duplicates line 123)
DROP INDEX IF EXISTS "items_type_idx";

-- ChatbotFlow: indexes on columns being removed (country, utm_source)
DROP INDEX IF EXISTS "idx_chatbot_flows_country";
DROP INDEX IF EXISTS "idx_chatbot_flows_utm_source";

-- ============================================================================
-- 2. Table renames
-- ============================================================================

ALTER TABLE "chatbot_flows" RENAME TO "chat_sessions";
ALTER TABLE "chatbot_messages" RENAME TO "chat_messages";
ALTER TABLE "ai_generation_config" RENAME TO "ai_generation_configs";
ALTER TABLE "odk_tour_list" RENAME TO "odk_tours";
ALTER TABLE "faq_chat_config" RENAME TO "faq_chat_configs";

-- ============================================================================
-- 3. Rename indexes to match new table names
-- ============================================================================

-- chat_sessions (was chatbot_flows)
ALTER INDEX "idx_chatbot_flows_session_id" RENAME TO "idx_chat_sessions_session_id";
ALTER INDEX "idx_chatbot_flows_user_id" RENAME TO "idx_chat_sessions_user_id";
ALTER INDEX "idx_chatbot_flows_estimate_id" RENAME TO "idx_chat_sessions_estimate_id";
ALTER INDEX "idx_chatbot_flows_is_completed" RENAME TO "idx_chat_sessions_is_completed";
ALTER INDEX "idx_chatbot_flows_current_step" RENAME TO "idx_chat_sessions_current_step";
ALTER INDEX "idx_chatbot_flows_created_at" RENAME TO "idx_chat_sessions_created_at";
ALTER INDEX "idx_chatbot_flows_visitor_id" RENAME TO "idx_chat_sessions_visitor_id";
ALTER INDEX "idx_chatbot_flows_completed_date" RENAME TO "idx_chat_sessions_completed_date";

-- chat_messages (was chatbot_messages)
ALTER INDEX "idx_chatbot_messages_session_id" RENAME TO "idx_chat_messages_session_id";
ALTER INDEX "idx_chatbot_messages_created_at" RENAME TO "idx_chat_messages_created_at";

-- odk_tours (was odk_tour_list)
ALTER INDEX "idx_odk_tour_list_active" RENAME TO "idx_odk_tours_active";
ALTER INDEX "idx_odk_tour_list_region" RENAME TO "idx_odk_tours_region";

-- Rename unnamed indexes (Prisma auto-generated names)
ALTER INDEX "ai_prompt_templates_category_idx" RENAME TO "idx_ai_prompt_templates_category";
ALTER INDEX "items_area_idx" RENAME TO "idx_items_area";
ALTER INDEX "items_categories_idx" RENAME TO "idx_items_categories";
ALTER INDEX "items_region_idx" RENAME TO "idx_items_region";
ALTER INDEX "suggested_places_best_match_score_idx" RENAME TO "idx_suggested_places_best_match";
ALTER INDEX "suggested_places_count_idx" RENAME TO "idx_suggested_places_count";
ALTER INDEX "suggested_places_created_at_idx" RENAME TO "idx_suggested_places_created_at";
ALTER INDEX "suggested_places_status_idx" RENAME TO "idx_suggested_places_status";

-- Rename constraint names for renamed tables
ALTER TABLE "chat_sessions" RENAME CONSTRAINT "chatbot_flows_pkey" TO "chat_sessions_pkey";
ALTER TABLE "chat_sessions" RENAME CONSTRAINT "chatbot_flows_visitor_id_fkey" TO "chat_sessions_visitor_id_fkey";
ALTER INDEX "chatbot_flows_session_id_key" RENAME TO "chat_sessions_session_id_key";

ALTER TABLE "chat_messages" RENAME CONSTRAINT "chatbot_messages_pkey" TO "chat_messages_pkey";
ALTER TABLE "chat_messages" RENAME CONSTRAINT "chatbot_messages_session_id_fkey" TO "chat_messages_session_id_fkey";

ALTER TABLE "ai_generation_configs" RENAME CONSTRAINT "ai_generation_config_pkey" TO "ai_generation_configs_pkey";

ALTER TABLE "odk_tours" RENAME CONSTRAINT "odk_tour_list_pkey" TO "odk_tours_pkey";
ALTER INDEX "odk_tour_list_slug_key" RENAME TO "odk_tours_slug_key";

ALTER TABLE "faq_chat_configs" RENAME CONSTRAINT "faq_chat_config_pkey" TO "faq_chat_configs_pkey";

-- ============================================================================
-- 4. Tour coordinate fields: rename + type change
-- ============================================================================

ALTER TABLE "tours" RENAME COLUMN "latitude" TO "lat";
ALTER TABLE "tours" RENAME COLUMN "longitude" TO "lng";
ALTER TABLE "tours" ALTER COLUMN "lat" TYPE DECIMAL(18, 10);
ALTER TABLE "tours" ALTER COLUMN "lng" TYPE DECIMAL(18, 10);

-- ============================================================================
-- 5. Decimal precision normalization
-- ============================================================================

-- Tour price: (10,2) → (12,2)
ALTER TABLE "tours" ALTER COLUMN "price" TYPE DECIMAL(12, 2);

-- Item prices: (15,2) → (12,2)
ALTER TABLE "items" ALTER COLUMN "price" TYPE DECIMAL(12, 2);
ALTER TABLE "items" ALTER COLUMN "weekday_price" TYPE DECIMAL(12, 2);
ALTER TABLE "items" ALTER COLUMN "weekend_price" TYPE DECIMAL(12, 2);

-- Booking: (10,2) → (12,2)
ALTER TABLE "bookings" ALTER COLUMN "unit_price" TYPE DECIMAL(12, 2);
ALTER TABLE "bookings" ALTER COLUMN "total_amount" TYPE DECIMAL(12, 2);

-- Payment: (10,2) → (12,2)
ALTER TABLE "payments" ALTER COLUMN "amount" TYPE DECIMAL(12, 2);
ALTER TABLE "payments" ALTER COLUMN "refunded_amount" TYPE DECIMAL(12, 2);

-- Goods: (10,2) → (12,2)
ALTER TABLE "goods" ALTER COLUMN "price" TYPE DECIMAL(12, 2);

-- OdkTours: (10,2) → (12,2)
ALTER TABLE "odk_tours" ALTER COLUMN "price" TYPE DECIMAL(12, 2);

-- ============================================================================
-- 6. VarChar size normalization
-- ============================================================================

ALTER TABLE "faq_chat_logs" ALTER COLUMN "country" TYPE VARCHAR(50);

-- ============================================================================
-- 7. ChatbotFlow → VisitorSession backfill + column removal
-- ============================================================================

-- Backfill: create VisitorSession records for chat_sessions that have
-- geo/tracking data but no visitor_id
DO $$
DECLARE
  flow RECORD;
  new_id UUID;
BEGIN
  FOR flow IN
    SELECT * FROM "chat_sessions"
    WHERE "visitor_id" IS NULL
      AND ("ip_address" IS NOT NULL OR "country" IS NOT NULL)
  LOOP
    INSERT INTO "visitor_sessions" (
      "id", "ip_address", "user_agent", "country", "country_name", "city", "timezone",
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "referrer_url", "landing_page", "created_at"
    ) VALUES (
      uuid_generate_v4(), flow."ip_address", flow."user_agent",
      flow."country", flow."country_name", flow."city", flow."timezone",
      flow."utm_source", flow."utm_medium", flow."utm_campaign",
      flow."utm_term", flow."utm_content",
      flow."referrer_url", flow."landing_page", flow."created_at"
    ) RETURNING "id" INTO new_id;
    UPDATE "chat_sessions" SET "visitor_id" = new_id WHERE "id" = flow."id";
  END LOOP;
END $$;

-- Drop duplicate columns from chat_sessions (now in visitor_sessions)
ALTER TABLE "chat_sessions"
  DROP COLUMN IF EXISTS "ip_address",
  DROP COLUMN IF EXISTS "user_agent",
  DROP COLUMN IF EXISTS "country",
  DROP COLUMN IF EXISTS "country_name",
  DROP COLUMN IF EXISTS "city",
  DROP COLUMN IF EXISTS "timezone",
  DROP COLUMN IF EXISTS "utm_source",
  DROP COLUMN IF EXISTS "utm_medium",
  DROP COLUMN IF EXISTS "utm_campaign",
  DROP COLUMN IF EXISTS "utm_term",
  DROP COLUMN IF EXISTS "utm_content",
  DROP COLUMN IF EXISTS "referrer_url",
  DROP COLUMN IF EXISTS "landing_page";

-- ============================================================================
-- 8. Add missing index (reviews.booking_id)
-- ============================================================================

CREATE INDEX IF NOT EXISTS "idx_reviews_booking_id" ON "reviews"("booking_id");
