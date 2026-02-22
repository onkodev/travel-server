-- FAQ 벡터 검색 인덱스 (IVFFlat, cosine similarity)
-- lists 값은 FAQ 수의 sqrt 기준. 1000개 이하면 100이 적절.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_faqs_embedding_ivfflat
ON faqs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- OdkTourList 벡터 검색 인덱스
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_odk_tour_list_embedding_ivfflat
ON odk_tour_list USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
