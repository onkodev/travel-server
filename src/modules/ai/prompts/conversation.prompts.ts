/**
 * 대화 관련 프롬프트
 */

export interface TravelAssistantContext {
  tripDates?: { start: string; end: string };
  region?: string;
  interests?: string[];
  currentItinerary?: Array<{ dayNumber: number; name: string; category: string }>;
}

/**
 * 컨텍스트 정보 문자열 생성 헬퍼
 */
export function buildContextInfo(context?: TravelAssistantContext): string {
  if (!context) return '';

  let contextInfo = '';

  if (context.tripDates) {
    contextInfo += `Trip dates: ${context.tripDates.start} to ${context.tripDates.end}\n`;
  }
  if (context.region) {
    contextInfo += `Region: ${context.region}\n`;
  }
  if (context.interests?.length) {
    contextInfo += `Interests: ${context.interests.join(', ')}\n`;
  }
  if (context.currentItinerary?.length) {
    const itineraryText = context.currentItinerary
      .map((item) => `Day ${item.dayNumber}: ${item.name} (${item.category})`)
      .join('\n');
    contextInfo += `Current itinerary:\n${itineraryText}\n`;
  }

  return contextInfo;
}
