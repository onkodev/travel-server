-- AiGenerationConfig에 gemini_model 필드 추가
ALTER TABLE ai_generation_configs
  ADD COLUMN gemini_model VARCHAR(50) NOT NULL DEFAULT 'gemini-2.5-flash';
