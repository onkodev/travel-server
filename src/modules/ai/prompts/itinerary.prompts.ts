/**
 * 일정 관련 프롬프트
 */

export interface ModificationIntentParams {
  itineraryText: string;
  interests: string;
  region: string;
  userMessage: string;
}

export const MODIFICATION_INTENT_PROMPT = (
  params: ModificationIntentParams,
): string =>
  `You are an AI assistant helping users modify their Korea travel itinerary.

Current itinerary:
${params.itineraryText}

User's interests: ${params.interests}
Region: ${params.region}

User's request: "${params.userMessage}"

Analyze the user's request and determine what action they want to take.

Return ONLY a JSON object with these fields:
{
  "action": "regenerate_day" | "add_item" | "remove_item" | "replace_item" | "general_feedback",
  "dayNumber": number | null,
  "itemName": string | null,
  "category": string | null,
  "confidence": 0.0 to 1.0,
  "explanation": "brief explanation of interpretation"
}

Action definitions:
- regenerate_day: User wants to completely redo a specific day's schedule
- add_item: User wants to add a specific place or activity
- remove_item: User wants to remove something (by name or category like "shopping")
- replace_item: User wants to swap a specific item with something else
- general_feedback: User is giving positive feedback or asking general questions

Examples:
- "Day 2 doesn't look good" → regenerate_day, dayNumber: 2
- "I want to visit Namsan Tower" → add_item, itemName: "Namsan Tower"
- "Remove shopping" → remove_item, category: "shopping"
- "Change Myeongdong to something else" → replace_item, itemName: "Myeongdong"
- "Add more food places" → add_item, category: "food"
- "Looks great!" → general_feedback`;

export const MODIFICATION_INTENT_CONFIG = {
  temperature: 0.2,
  maxOutputTokens: 1024,
};

export interface SelectBestItemParams {
  itemList: string;
  userRequest: string;
  interests: string;
  context?: string;
}

export const SELECT_BEST_ITEM_PROMPT = (params: SelectBestItemParams): string =>
  `You are a Korea travel expert helping select a place for a trip.

User request: "${params.userRequest}"
User interests: ${params.interests}
${params.context ? `Context: ${params.context}` : ''}

Available places (you MUST choose from this list):
${params.itemList}

Analyze the user's request and interests, then select the BEST matching place from the list above.

Return ONLY a JSON object:
{
  "selectedId": <the ID number of your chosen place>,
  "reason": "brief reason why this place matches the user's request"
}`;

export const SELECT_BEST_ITEM_CONFIG = {
  temperature: 0.3,
  maxOutputTokens: 512,
};

export interface SelectMultipleItemsParams {
  itemList: string;
  count: number;
  interests: string;
  dayNumber: number;
  region: string;
}

export const SELECT_MULTIPLE_ITEMS_PROMPT = (
  params: SelectMultipleItemsParams,
): string =>
  `You are a Korea travel expert creating Day ${params.dayNumber} of a trip in ${params.region}.

User interests: ${params.interests}

Available places (you MUST choose from this list only):
${params.itemList}

Select ${params.count} places that would make a great day itinerary. Consider:
- Logical visiting order (nearby places together)
- Mix of different types (culture, food, shopping, etc.)
- User's interests

Return ONLY a JSON array:
[
  { "selectedId": <ID number>, "reason": "brief reason" },
  ...
]`;

export const SELECT_MULTIPLE_ITEMS_CONFIG = {
  temperature: 0.5,
  maxOutputTokens: 1024,
};

export interface DayTimelineParams {
  dayNumber: number;
  itemList: string;
}

export const DAY_TIMELINE_PROMPT = (params: DayTimelineParams): string =>
  `You are a travel itinerary writer. Create a timeline for Day ${params.dayNumber} of a Korea travel itinerary.

Items for this day (in order):
${params.itemList}

Instructions:
- Write in English
- Use this EXACT format for each item:
  - [Place Name] – [1-2 sentence description of what to do/see there]
- Start with "- Pick up at [first accommodation or meeting point]" if there's accommodation/transportation
- End with "- Drop off at [accommodation]" if there's accommodation
- For places: describe the experience, atmosphere, or highlights
- For transportation: briefly mention the journey
- Keep descriptions engaging but concise
- Use en-dash (–) not hyphen (-) between place and description

Example output:
- Pick up at Lotte Hotel Seoul
- Gyeongbokgung Palace – Explore Korea's grandest palace and watch the royal guard ceremony
- Bukchon Hanok Village – Stroll through charming traditional alleyways with 600-year-old houses
- Insadong – Browse antique shops and enjoy traditional Korean tea
- Myeongdong – Shop for K-beauty products and taste famous street food
- Drop off at Lotte Hotel Seoul

Generate the timeline:`;

export const DAY_TIMELINE_CONFIG = {
  temperature: 0.7,
  maxOutputTokens: 500,
};
