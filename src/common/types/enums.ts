/**
 * 견적 AI 상태 열거형
 */
export enum EstimateStatusAi {
  DRAFT = 'draft',
  PENDING = 'pending',
  SENT = 'sent',
  APPROVED = 'approved',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

/**
 * 견적 소스 열거형
 */
export enum EstimateSource {
  AI = 'ai',
  MANUAL = 'manual',
}
