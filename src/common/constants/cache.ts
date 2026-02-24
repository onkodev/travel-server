/**
 * 캐시 TTL 상수 (밀리초)
 * 각 서비스에서 분산 정의되던 캐시 TTL을 중앙 관리.
 */
export const CACHE_TTL = {
  TOKEN: 1 * 60 * 1000, // 1분
  PROFILE: 2 * 60 * 1000, // 2분
  DASHBOARD: 2 * 60 * 1000, // 2분
  TOUR: 10 * 60 * 1000, // 10분
  EMBEDDING: 5 * 60 * 1000, // 5분
  AI_CONFIG: 30 * 60 * 1000, // 30분
  ITEM: 60 * 60 * 1000, // 1시간
  FAQ_STATS: 60 * 1000, // 1분
  FAQ_CHAT_STATS: 2 * 60 * 1000, // 2분
} as const;
