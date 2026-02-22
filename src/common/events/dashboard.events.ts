/**
 * 대시보드 캐시 무효화 이벤트
 * 데이터 변경 시 각 서비스에서 emit → DashboardService가 캐시 클리어
 */

export const DASHBOARD_EVENTS = {
  INVALIDATE: 'dashboard.invalidate',
} as const;
