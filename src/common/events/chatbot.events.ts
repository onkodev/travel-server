/**
 * 챗봇 SSE 관련 이벤트 정의
 */

export const CHATBOT_EVENTS = {
  NEW_MESSAGE: 'chatbot.new_message',
  ESTIMATE_STATUS_CHANGED: 'chatbot.estimate_status_changed',
  TYPING_INDICATOR: 'chatbot.typing_indicator',
} as const;

/**
 * 새 메시지 이벤트 페이로드
 */
export interface ChatbotNewMessageEvent {
  sessionId: string;
  message: {
    id: number;
    role: 'bot' | 'user' | 'admin';
    content: string;
    createdAt: Date;
  };
}

/**
 * 견적 상태 변경 이벤트 페이로드
 */
export interface ChatbotEstimateStatusEvent {
  sessionId: string;
  estimateId: number;
  status: string;
}

/**
 * 타이핑 인디케이터 이벤트 페이로드
 */
export interface ChatbotTypingEvent {
  sessionId: string;
  isTyping: boolean;
}
