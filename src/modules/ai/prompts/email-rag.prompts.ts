/**
 * 관심사 키워드 확장 맵
 * 챗봇 카테고리 키 → 구체적 장소/경험 설명 (RAG + Gemini 양쪽에서 사용)
 */
/**
 * 챗봇 관심사 키 → DB 카테고리 값 매핑
 * DB 카테고리: Theme:*, Target:*, Demographic:*
 */
export const INTEREST_TO_DB_CATEGORIES: Record<string, string[]> = {
  // 메인 카테고리
  culture: ['Theme:History', 'Theme:Art'],
  kculture: ['Theme:K-pop'],
  food_shopping: ['Theme:Foodie', 'Theme:Shopping'],
  nature: ['Theme:Nature'],
  local: ['Target:Local-Vibe'],
  // 서브 카테고리
  historical: ['Theme:History'],
  museums: ['Theme:Art'],
  architecture: ['Theme:Art'],
  kpop: ['Theme:K-pop'],
  kdrama: ['Theme:K-pop'],
  beauty: ['Theme:Shopping'],
  food: ['Theme:Foodie'],
  markets: ['Theme:Shopping'],
  shopping: ['Theme:Shopping'],
  fashion: ['Theme:Shopping'],
  hiking: ['Theme:Nature'],
  adventure: ['Theme:Adventure'],
  hidden_places: ['Target:Local-Vibe'],
  like_local: ['Target:Local-Vibe'],
  sports: ['Theme:Adventure'],
  luxury: ['Theme:Luxury'],
  nature_sub: ['Theme:Nature'],
};

/**
 * 관심사 키 목록 → DB 카테고리 값 배열 (중복 제거)
 */
export function interestToCategories(interests: string[]): string[] {
  const cats = new Set<string>();
  for (const key of interests) {
    const mapped = INTEREST_TO_DB_CATEGORIES[key];
    if (mapped) mapped.forEach((c) => cats.add(c));
  }
  return [...cats];
}

export const INTEREST_KEYWORDS: Record<string, string> = {
  // 메인 카테고리
  culture: 'palaces, temples, historical sites, traditional villages, museums, UNESCO heritage, royal tombs, fortress walls',
  kculture: 'K-pop fan spots, K-drama filming locations, K-beauty shops, Gangnam entertainment, Hongdae indie scene, concert halls',
  food_shopping: 'Korean BBQ restaurants, street food markets, traditional food alleys, Gwangjang Market, Myeongdong shopping, Korean cosmetics shops',
  nature: 'national parks, hiking trails, Bukhansan, scenic viewpoints, botanical gardens, riverside walks, beaches',
  local: 'local neighborhoods, hidden cafes, off-the-beaten-path alleys, temple stay experiences, traditional craft workshops',
  // 서브 카테고리
  historical: 'Joseon dynasty palaces, fortress walls, royal tombs, war memorials',
  museums: 'National Museum of Korea, art galleries, war museums, folk museums',
  architecture: 'Dongdaemun Design Plaza, traditional hanok, modern Seoul architecture',
  kpop: 'HYBE Insight, SM Entertainment, idol cafes, K-pop merchandise shops, Gangnam K-Star Road',
  kdrama: 'drama filming locations, Nami Island, K-drama photo spots, famous drama sets',
  beauty: 'K-beauty flagship stores, Myeongdong cosmetics street, skincare experiences',
  food: 'Korean BBQ, bibimbap, kimchi jjigae, tteokbokki, fine dining Korean cuisine',
  markets: 'Namdaemun Market, Gwangjang Market, Noryangjin Fish Market, Dongdaemun wholesale',
  shopping: 'Myeongdong, Garosu-gil, COEX Mall, Hongdae vintage shops',
  fashion: 'Gangnam boutiques, Dongdaemun fashion, Korean designer brands',
  hiking: 'Bukhansan trails, Inwangsan city wall, Achasan, Gwanaksan',
  adventure: 'zip-lining, rafting, paragliding, outdoor activities near Seoul',
  hidden_places: 'Ikseon-dong hanok alley, Seongsu-dong cafes, Yeonnam-dong, Mangwon neighborhood',
  like_local: 'local cafes, neighborhood walks, pojangmacha experiences, jjimjilbang',
  sports: 'baseball games, taekwondo, archery, esports arena',
  luxury: 'luxury hotels, premium spa, Cheongdam-dong, high-end experiences',
  nature_sub: 'national parks, scenic viewpoints, botanical gardens, riverside walks',
};

// 메인 카테고리 → 소속 서브 카테고리 매핑
const MAIN_TO_SUBS: Record<string, string[]> = {
  culture: ['historical', 'museums', 'architecture'],
  kculture: ['kpop', 'kdrama', 'beauty'],
  food_shopping: ['food', 'markets', 'shopping', 'fashion'],
  nature: ['nature', 'hiking', 'adventure', 'hidden_places'],
  local: ['like_local', 'sports', 'luxury'],
};

/**
 * 관심사 라벨 → 확장 키워드 텍스트로 변환
 * 서브 관심사를 우선 사용 (더 구체적), 메인은 해당 메인의 서브가 하나도 선택되지 않았을 때만 추가
 */
export function expandInterests(mainInterests: string[], subInterests: string[]): string {
  const expanded: string[] = [];
  const subSet = new Set(subInterests);

  // 서브 관심사 우선 (더 구체적)
  for (const sub of subInterests) {
    if (INTEREST_KEYWORDS[sub]) expanded.push(INTEREST_KEYWORDS[sub]);
  }

  // 메인 관심사: 해당 메인에 속하는 서브가 하나도 선택되지 않은 경우에만 추가
  for (const main of mainInterests) {
    const subs = MAIN_TO_SUBS[main];
    const hasCoveringSubSelected = subs?.some((s) => subSet.has(s));
    if (INTEREST_KEYWORDS[main] && !hasCoveringSubSelected) {
      expanded.push(INTEREST_KEYWORDS[main]);
    }
  }

  return expanded.join(', ') || 'general sightseeing';
}

