-- ═══════════════════════════════════════════════
-- 1. AiGenerationConfig에 FaqChatConfig 필드 추가
-- ═══════════════════════════════════════════════
ALTER TABLE ai_generation_configs
  ADD COLUMN direct_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  ADD COLUMN rag_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN no_match_response TEXT;

-- 기존 FaqChatConfig 데이터 백필
UPDATE ai_generation_configs SET
  direct_threshold = COALESCE(
    (SELECT direct_threshold FROM faq_chat_configs WHERE id = 1), 0.7),
  rag_threshold = COALESCE(
    (SELECT rag_threshold FROM faq_chat_configs WHERE id = 1), 0.5),
  no_match_response = (SELECT no_match_response FROM faq_chat_configs WHERE id = 1)
WHERE id = 1;

-- faq_chat_configs 테이블 삭제
DROP TABLE faq_chat_configs;

-- ═══════════════════════════════════════════════
-- 2. FaqChatLog geo 필드 제거
-- ═══════════════════════════════════════════════

-- 2-a. visitorId NULL + ipAddress 있는 로그에 visitor_sessions 연결
DO $$
DECLARE
  log_ip RECORD;
  found_id UUID;
BEGIN
  FOR log_ip IN
    SELECT DISTINCT ip_address, country, country_name, city, MIN(created_at) as first_at
    FROM faq_chat_logs
    WHERE visitor_id IS NULL AND ip_address IS NOT NULL
    GROUP BY ip_address, country, country_name, city
  LOOP
    SELECT id INTO found_id FROM visitor_sessions
    WHERE ip_address = log_ip.ip_address LIMIT 1;

    IF found_id IS NULL THEN
      INSERT INTO visitor_sessions (id, ip_address, country, country_name, city, created_at)
      VALUES (uuid_generate_v4(), log_ip.ip_address, log_ip.country,
              log_ip.country_name, log_ip.city, log_ip.first_at)
      RETURNING id INTO found_id;
    END IF;

    UPDATE faq_chat_logs SET visitor_id = found_id
    WHERE visitor_id IS NULL AND ip_address = log_ip.ip_address;
  END LOOP;
END $$;

-- 2-b. FK 제약 추가
ALTER TABLE faq_chat_logs ADD CONSTRAINT faq_chat_logs_visitor_id_fkey
  FOREIGN KEY (visitor_id) REFERENCES visitor_sessions(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- 2-c. geo 컬럼 삭제
ALTER TABLE faq_chat_logs
  DROP COLUMN ip_address,
  DROP COLUMN country,
  DROP COLUMN country_name,
  DROP COLUMN city;

-- 2-d. visitorId 인덱스
CREATE INDEX idx_faq_chat_logs_visitor_id ON faq_chat_logs(visitor_id);
