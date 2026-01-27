/**
 * 견적 관련 이벤트 정의
 */

export const ESTIMATE_EVENTS = {
  SENT: 'estimate.sent',
} as const;

/**
 * 견적 발송 이벤트 페이로드
 */
export interface EstimateSentEvent {
  chatSessionId: string;
  estimateId: number;
}
