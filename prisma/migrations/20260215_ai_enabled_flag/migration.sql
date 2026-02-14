ALTER TABLE ai_generation_configs
  ADD COLUMN ai_enabled BOOLEAN NOT NULL DEFAULT true;

-- 배포 시 비활성화: UPDATE ai_generation_configs SET ai_enabled = false WHERE id = 1;
