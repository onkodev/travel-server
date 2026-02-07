/**
 * FAQ 추출 관련 프롬프트
 */

export interface FaqExtractionParams {
  subject: string;
  emailBody: string;
}

export const FAQ_EXTRACTION_PROMPT = (
  params: FaqExtractionParams,
): string => `You are a customer service analyst for a Korean travel company.
Extract FAQ Q&A pairs from the email thread below.

## Email Subject:
${params.subject || '(No subject)'}

## Email Content:
${params.emailBody}

## Extraction Rules:
1. **Only extract** from threads where a customer asked a question AND we replied
2. Skip one-way emails (newsletters, ads, internal emails) — return empty array []
3. Convert customer questions into natural FAQ format
4. Write answers based on our email replies, concise and professional
5. **Bilingual output required**: Provide BOTH English and Korean for each question and answer
6. Skip non-travel emails (spam, ads, internal) — return empty array []
7. Include relevant tags (in English) and AI confidence score (0.0~1.0) for each Q&A
8. Generalize personal info (names, specific dates, exact prices)
9. **Important**: Include the original email excerpts (questionSource, answerSource) that each Q&A is based on

Respond ONLY with the following JSON format (no other text):
[
  {
    "question": "English question",
    "questionKo": "한국어 질문",
    "answer": "English answer",
    "answerKo": "한국어 답변",
    "tags": ["tag1", "tag2"],
    "confidence": 0.85,
    "category": "general | booking | tour | payment | transportation | accommodation | visa | other",
    "questionSource": "Original email excerpt this question is based on",
    "answerSource": "Original email excerpt this answer is based on"
  }
]

Return empty array [] if no Q&A pairs can be extracted.`;

export const FAQ_EXTRACTION_CONFIG = {
  temperature: 0.3,
  maxOutputTokens: 4096,
};
