/**
 * 관심사 키워드 확장 맵
 * 챗봇 카테고리 키 → 구체적 장소/경험 설명 (RAG 쿼리 + Gemini 프롬프트 양쪽에서 사용)
 */
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

/**
 * 관심사 라벨 → 확장 키워드 텍스트로 변환
 * 서브 관심사를 우선 사용 (더 구체적), 메인은 서브가 없을 때 보완
 */
export function expandInterests(mainInterests: string[], subInterests: string[]): string {
  const expanded: string[] = [];

  // 서브 관심사 우선 (더 구체적)
  for (const sub of subInterests) {
    if (INTEREST_KEYWORDS[sub]) expanded.push(INTEREST_KEYWORDS[sub]);
  }

  // 메인 관심사 (매칭되는 서브가 하나도 없는 경우만 추가)
  for (const main of mainInterests) {
    if (INTEREST_KEYWORDS[main] && !subInterests.some((s) => INTEREST_KEYWORDS[s])) {
      expanded.push(INTEREST_KEYWORDS[main]);
    }
  }

  return expanded.join(', ') || 'general sightseeing';
}
