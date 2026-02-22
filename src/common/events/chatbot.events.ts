/**
 * 챗봇 이벤트 정의 (SSE 제거 후 최소화)
 */

export const CHATBOT_EVENTS = {
  TYPING_INDICATOR: 'chatbot.typing_indicator',
} as const;

/**
 * 타이핑 인디케이터 이벤트 페이로드
 */
export interface ChatbotTypingEvent {
  sessionId: string;
  isTyping: boolean;
}
