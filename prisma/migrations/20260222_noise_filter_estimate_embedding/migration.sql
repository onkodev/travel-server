-- 1. EmailThread: 노이즈 제외 플래그
ALTER TABLE "email_threads" ADD COLUMN "exclude_from_rag" BOOLEAN NOT NULL DEFAULT false;

-- 2. Estimate: 임베딩 벡터
ALTER TABLE "estimates" ADD COLUMN "embedding" vector(768);

-- 3. 노이즈 패턴 일괄 마킹 (시스템 알림, 예약확인 등)
UPDATE "email_threads"
SET "exclude_from_rag" = true
WHERE
  "subject" ~* '(delivery status notification|auto[- ]?reply|automatic reply|out of office|undeliverable|mail delivery|returned mail|failure notice)'
  OR "subject" ~* '(booking confirmation|reservation confirmed|payment (receipt|confirmation|received)|order confirmation)'
  OR "subject" ~* '(newsletter|subscription|verify your|password reset|security alert|login notification)'
  OR "subject" ~* '(two[- ]?factor|verification code|no[- ]?reply|do[- ]?not[- ]?reply)'
  OR "from_email" ~* '(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster)@'
  OR "from_email" ~* '(notifications?|alerts?|system|automated)@'
  OR "from_email" ~* '@(mailchimp|sendgrid|mailgun|amazonaws)\.'
  OR "from_email" ~* '@(booking|agoda|expedia|airbnb|hotels)\.';

-- 4. 인덱스
CREATE INDEX IF NOT EXISTS "idx_email_threads_exclude_rag" ON "email_threads" ("exclude_from_rag");
CREATE INDEX IF NOT EXISTS "idx_estimates_embedding" ON "estimates" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);
