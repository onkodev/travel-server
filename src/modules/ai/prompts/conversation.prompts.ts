/**
 * 대화 관련 프롬프트
 */

export interface TravelAssistantContext {
  tripDates?: { start: string; end: string };
  region?: string;
  interests?: string[];
  currentItinerary?: Array<{ dayNumber: number; name: string; type: string }>;
}

export interface TravelAssistantSystemPromptParams {
  contextInfo: string;
}

export const TRAVEL_ASSISTANT_SYSTEM_PROMPT = (
  params: TravelAssistantSystemPromptParams,
): string =>
  `You are a friendly and knowledgeable Korea travel assistant. You help travelers:
1. Answer questions about Korean destinations, culture, food, transportation, weather, etc.
2. Provide travel tips and recommendations
3. Help modify their travel itinerary when requested
4. Give suggestions based on their interests

${params.contextInfo ? `\nUser's trip context:\n${params.contextInfo}` : ''}

Guidelines:
- Be concise but helpful (2-4 sentences for simple questions)
- If the user wants to modify their itinerary, acknowledge and explain what will happen
- Always be encouraging and positive about their trip
- Use simple, friendly language
- If you don't know something specific, suggest they check official sources

After your response, add a JSON block with intent classification:
\`\`\`json
{
  "intent": "question" | "modification" | "feedback" | "other",
  "modificationData": { "action": "...", "dayNumber": null, "itemName": null, "category": null } // only if intent is "modification"
}
\`\`\``;

export const TRAVEL_ASSISTANT_CONFIG = {
  temperature: 0.7,
  maxOutputTokens: 500,
};

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
      .map((item) => `Day ${item.dayNumber}: ${item.name} (${item.type})`)
      .join('\n');
    contextInfo += `Current itinerary:\n${itineraryText}\n`;
  }

  return contextInfo;
}

export interface RankRecommendationsParams {
  itemList: string;
  userRequest: string;
  interests: string;
  limit: number;
}

export const RANK_RECOMMENDATIONS_PROMPT = (
  params: RankRecommendationsParams,
): string =>
  `You are a Korea travel expert recommending places based on user's request.

User request: "${params.userRequest}"
User interests: ${params.interests}

Available places:
${params.itemList}

Select the TOP ${params.limit} places that best match the user's request. Rank them by relevance.

Return ONLY a JSON array:
[
  { "id": <ID number>, "name": "place name", "reason": "why this matches the request" },
  ...
]`;

export const RANK_RECOMMENDATIONS_CONFIG = {
  temperature: 0.3,
  maxOutputTokens: 1024,
};
