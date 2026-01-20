import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

export interface EstimateItemForAnalysis {
  id: string;
  name: string;
  type: string;
  region?: string;
}

export interface TimelineItem {
  name: string;
  type: string;
  order: number;
}

const ITEM_TYPE_LABELS: Record<string, string> = {
  place: '여행지/관광명소',
  accommodation: '숙소/호텔',
  transportation: '교통수단',
  contents: '체험/액티비티',
};

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private apiKey: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
  }

  // Gemini API 호출 공통 메서드
  private async callGemini(prompt: string, options?: {
    temperature?: number;
    maxOutputTokens?: number;
    systemPrompt?: string;
    history?: Array<{ role: string; parts: Array<{ text: string }> }>;
  }) {
    if (!this.apiKey) {
      throw new BadRequestException('Gemini API key is not configured');
    }

    const apiUrl = `${this.baseUrl}?key=${this.apiKey}`;

    const body: any = {
      contents: options?.history
        ? [...options.history, { role: 'user', parts: [{ text: prompt }] }]
        : [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxOutputTokens ?? 1024,
      },
    };

    if (options?.systemPrompt) {
      body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`Gemini API error: ${response.status} ${errorBody}`);
        throw new BadRequestException('AI 응답 생성 실패');
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        this.logger.error(`Empty Gemini response: ${JSON.stringify(data)}`);
        throw new BadRequestException('Gemini returned empty response');
      }

      return text;
    } catch (error) {
      this.logger.error('Gemini API request failed:', error);
      throw new BadRequestException('AI 서비스 오류');
    }
  }

  // JSON 파싱 헬퍼 (마크다운 코드 블록 처리)
  private parseJsonResponse<T>(text: string, defaultValue: T): T {
    try {
      let jsonStr = text;

      // 마크다운 코드 블록 제거 (```json ... ``` 또는 ``` ... ```)
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      }

      // JSON 객체 추출
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      this.logger.error('JSON 파싱 실패:', e);
    }
    return defaultValue;
  }

  // 견적 요청 분석
  async analyzeEstimateRequest(content: string) {
    const prompt = `
다음 여행 견적 요청을 분석하여 JSON 형식으로 정보를 추출해주세요:

요청 내용:
${content}

다음 형식으로 응답해주세요:
{
  "destination": "목적지",
  "startDate": "시작일 (YYYY-MM-DD 형식, 추정 가능하면)",
  "endDate": "종료일 (YYYY-MM-DD 형식, 추정 가능하면)",
  "adults": 성인 수,
  "children": 어린이 수,
  "infants": 유아 수,
  "budget": 예산 (숫자, KRW 기준),
  "budgetLevel": "budget|mid|premium|luxury",
  "groupType": "solo|couple|family|friends|group",
  "interests": ["관심사1", "관심사2"],
  "specialNeeds": ["특별 요청사항"],
  "keywords": ["키워드1", "키워드2"]
}

정보가 없으면 null로 표시하세요.
`;

    const text = await this.callGemini(prompt, { temperature: 0.2 });
    return this.parseJsonResponse(text, {});
  }

  // 여행 일정 생성
  async generateTimeline(params: {
    destination: string;
    days: number;
    interests?: string[];
    items?: any[];
  }) {
    const { destination, days, interests, items } = params;

    const itemsList =
      items?.map((item) => `- ${item.nameKor} (${item.type})`).join('\n') || '';

    const prompt = `
${destination} ${days}일 여행 일정을 작성해주세요.

${interests?.length ? `관심사: ${interests.join(', ')}` : ''}
${itemsList ? `\n포함할 장소:\n${itemsList}` : ''}

각 일차별로 자연스러운 동선으로 일정을 구성해주세요.
다음 JSON 형식으로 응답해주세요:

{
  "1": "Day 1 일정 설명...",
  "2": "Day 2 일정 설명...",
  ...
}
`;

    const text = await this.callGemini(prompt, {
      temperature: 0.7,
      maxOutputTokens: 2048,
    });
    return this.parseJsonResponse(text, {});
  }

  // 아이템 설명 생성 (기본)
  async generateItemContent(params: {
    name: string;
    type: string;
    address?: string;
  }) {
    const { name, type, address } = params;

    const prompt = `
다음 여행지/시설에 대한 영문 설명을 작성해주세요:

이름: ${name}
유형: ${type}
${address ? `주소: ${address}` : ''}

외국인 관광객을 위한 매력적인 설명을 2-3문장으로 작성해주세요.
`;

    const text = await this.callGemini(prompt, {
      temperature: 0.7,
      maxOutputTokens: 512,
    });

    return { description: text };
  }

  // 아이템 컨텐츠 생성 V2 (DB 업데이트 포함)
  async generateItemContentV2(params: {
    itemId: number;
    nameKor: string;
    nameEng: string;
    itemType: string;
  }) {
    const { itemId, nameKor, nameEng, itemType } = params;
    const typeLabel = ITEM_TYPE_LABELS[itemType] || itemType;

    const prompt = `당신은 한국 여행 전문가입니다. 아래 ${typeLabel}에 대해 키워드와 설명(한글/영문)을 생성해주세요.

장소명 (한글): ${nameKor}
장소명 (영문): ${nameEng || '없음'}
타입: ${typeLabel}

다음 JSON 형식으로만 응답해주세요 (다른 텍스트 없이):
{
  "keyword": "쉼표로 구분된 관련 키워드 5-8개 (예: 서울, 고궁, 역사, 전통문화, 포토스팟)",
  "description": "외국인 관광객을 위한 한글 설명 500자 이내. 장소의 설명, 특징, 볼거리, 추천 이유를 포함.",
  "descriptionEng": "English description for foreign tourists within 500 characters. Include description, features, attractions, and reasons to visit."
}`;

    const text = await this.callGemini(prompt, {
      temperature: 0.7,
      maxOutputTokens: 2048,
    });

    const result = this.parseJsonResponse(text, {
      keyword: '',
      description: '',
      descriptionEng: '',
    });

    if (result.keyword || result.description || result.descriptionEng) {
      await this.prisma.item.update({
        where: { id: itemId },
        data: {
          keyword: result.keyword,
          description: result.description,
          descriptionEng: result.descriptionEng,
        },
      });

      return { success: true, ...result };
    }

    return { success: false, ...result };
  }

  // 견적 분석 V2
  async analyzeEstimateV2(params: {
    estimateId: number;
    requestContent: string | null;
    items: EstimateItemForAnalysis[];
  }) {
    const { estimateId, requestContent, items } = params;

    // 아이템 정보 요약
    const itemsSummary = items.length > 0
      ? items.map((item) => `- ${item.name} (${item.type}${item.region ? `, ${item.region}` : ''})`).join('\n')
      : '아이템 없음';

    const prompt = `당신은 한국 인바운드 여행 전문가입니다. 고객의 여행 요청 내용과 견적 아이템을 분석해서 여행 정보를 추출해주세요.

## 고객 요청 내용:
${requestContent || '내용 없음'}

## 견적 아이템 목록:
${itemsSummary}

## 분석 요청:
위 정보를 바탕으로 다음을 추출해주세요:

1. regions: 방문 지역 (예: 서울, 부산, 제주 등)
2. interests: 관심 테마/카테고리 (맛집, 역사, 자연, 쇼핑, K-pop, 문화체험 등)
3. keywords: 구체적인 키워드 (음식명, 장소명, 활동명 등)
4. groupType: 그룹 유형 (solo, couple, family, friends, group 중 하나, 알 수 없으면 null)
5. budgetLevel: 예산 수준 (budget, mid, premium, luxury 중 하나, 알 수 없으면 null)
6. specialNeeds: 특별 요구사항 (wheelchair, vegetarian, halal, infant, pickup 등)

다음 JSON 형식으로만 응답해주세요 (다른 텍스트 없이):
{
  "regions": ["서울", "부산"],
  "interests": ["맛집", "역사"],
  "keywords": ["비빔밥", "경복궁", "한복체험"],
  "groupType": "family",
  "budgetLevel": "mid",
  "specialNeeds": []
}`;

    const text = await this.callGemini(prompt, { temperature: 0.3 });

    interface AnalysisResult {
      regions?: string[];
      interests?: string[];
      keywords?: string[];
      groupType?: string | null;
      budgetLevel?: string | null;
      specialNeeds?: string[];
    }

    const result = this.parseJsonResponse<AnalysisResult | null>(text, null);

    if (result) {
      // Prisma로 업데이트
      await this.prisma.estimate.update({
        where: { id: estimateId },
        data: {
          regions: result.regions || [],
          interests: result.interests || [],
          keywords: result.keywords || [],
          groupType: result.groupType || null,
          budgetLevel: result.budgetLevel || null,
          specialNeeds: result.specialNeeds || [],
        },
      });

      return {
        success: true,
        regions: result.regions || [],
        interests: result.interests || [],
        keywords: result.keywords || [],
        groupType: result.groupType || null,
        budgetLevel: result.budgetLevel || null,
        specialNeeds: result.specialNeeds || [],
      };
    }

    return {
      success: false,
      regions: [],
      interests: [],
      keywords: [],
      groupType: null,
      budgetLevel: null,
      specialNeeds: [],
    };
  }

  // 타임라인 생성 V2 (단일 일차)
  async generateTimelineV2(params: {
    dayNumber: number;
    date: string | null;
    items: TimelineItem[];
  }) {
    const { dayNumber, items } = params;

    if (!items || items.length === 0) {
      return { success: false, timeline: '' };
    }

    const sortedItems = [...items].sort((a, b) => a.order - b.order);
    const itemList = sortedItems
      .map((item) => `- ${item.name} (${item.type})`)
      .join('\n');

    const prompt = `You are a travel itinerary writer. Create a timeline for Day ${dayNumber} of a Korea travel itinerary.

Items for this day (in order):
${itemList}

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

    const text = await this.callGemini(prompt, {
      temperature: 0.7,
      maxOutputTokens: 500,
    });

    if (text.trim()) {
      return { success: true, timeline: text.trim() };
    }

    return { success: false, timeline: '' };
  }
}
