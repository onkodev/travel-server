export const TOUR_TYPES = {
  online: {
    label: 'Online Tour',
    labelKo: '온라인 투어',
    description: 'Self-guided walking tour with digital guidebook',
    descriptionKo: '디지털 가이드북으로 직접 걸으며 하는 투어',
    status: 'available',
    redirectUrl: 'https://tumakrguide.com',
  },
  private: {
    label: 'Private Tour',
    labelKo: '프라이빗 투어',
    description: 'Fixed itinerary tours with professional guide',
    descriptionKo: '전문 가이드와 함께하는 고정 일정 투어',
    status: 'available',
    redirectUrl: 'https://onedaykorea.com',
  },
  history: {
    label: 'History Tour',
    labelKo: '히스토리 투어',
    description: 'History-focused tours (Coming Soon)',
    descriptionKo: '역사에 초점을 맞춘 투어 (준비중)',
    status: 'coming_soon',
    redirectUrl: null,
  },
  multi_day: {
    label: 'Multi-day Tour',
    labelKo: '멀티데이 투어',
    description: 'Extended tours spanning multiple days (Coming Soon)',
    descriptionKo: '여러 날에 걸친 투어 (준비중)',
    status: 'coming_soon',
    redirectUrl: null,
  },
  custom: {
    label: 'Custom Tour',
    labelKo: '커스텀 투어',
    description: 'Build your own itinerary with AI + expert assistance',
    descriptionKo: 'AI와 전문가의 도움으로 나만의 일정 만들기',
    status: 'available',
    redirectUrl: null, // 챗봇 플로우 계속
  },
} as const;

export const INTEREST_MAIN = {
  culture: {
    label: 'Culture & History',
    labelKo: '문화 & 역사',
    sub: ['historical', 'museums', 'architecture'],
  },
  kculture: {
    label: 'K-Culture',
    labelKo: 'K-컬처',
    sub: ['kpop', 'kdrama'],
  },
  food_shopping: {
    label: 'Food & Shopping',
    labelKo: '음식 & 쇼핑',
    sub: ['food', 'markets', 'shopping', 'fashion'],
  },
  nature: {
    label: 'Nature & Adventure',
    labelKo: '자연 & 액티비티',
    sub: ['nature', 'hiking', 'adventure', 'hidden_places'],
  },
  local: {
    label: 'Local Experience',
    labelKo: '로컬 경험',
    sub: ['like_local', 'sports'],
  },
} as const;

export const INTEREST_SUB = {
  // Culture & History
  historical: {
    label: 'Historical Sites',
    labelKo: '역사 유적지',
    main: 'culture',
  },
  museums: {
    label: 'Museums',
    labelKo: '박물관',
    main: 'culture',
  },
  architecture: {
    label: 'Architecture',
    labelKo: '건축물',
    main: 'culture',
  },
  // K-Culture
  kpop: {
    label: 'K-pop',
    labelKo: '케이팝',
    main: 'kculture',
  },
  kdrama: {
    label: 'K-drama Locations',
    labelKo: '드라마 촬영지',
    main: 'kculture',
  },
  // Food & Shopping
  food: {
    label: 'Food',
    labelKo: '음식',
    main: 'food_shopping',
  },
  markets: {
    label: 'Markets',
    labelKo: '시장',
    main: 'food_shopping',
  },
  shopping: {
    label: 'Shopping',
    labelKo: '쇼핑',
    main: 'food_shopping',
  },
  fashion: {
    label: 'Fashion',
    labelKo: '패션',
    main: 'food_shopping',
  },
  // Nature & Adventure
  nature: {
    label: 'Nature',
    labelKo: '자연',
    main: 'nature',
  },
  hiking: {
    label: 'Hiking',
    labelKo: '하이킹',
    main: 'nature',
  },
  adventure: {
    label: 'Adventure',
    labelKo: '어드벤처',
    main: 'nature',
  },
  hidden_places: {
    label: 'Hidden Places',
    labelKo: '숨은 명소',
    main: 'nature',
  },
  // Local Experience
  like_local: {
    label: 'Like a Local',
    labelKo: '현지인처럼',
    main: 'local',
  },
  sports: {
    label: 'Sports',
    labelKo: '스포츠',
    main: 'local',
  },
} as const;

export const REGIONS = {
  seoul: {
    label: 'Seoul',
    labelKo: '서울',
    status: 'available',
  },
  busan: {
    label: 'Busan',
    labelKo: '부산',
    status: 'coming_soon',
  },
  jeju: {
    label: 'Jeju',
    labelKo: '제주',
    status: 'coming_soon',
  },
  gyeonggi: {
    label: 'Gyeonggi',
    labelKo: '경기',
    status: 'coming_soon',
  },
  gangwon: {
    label: 'Gangwon',
    labelKo: '강원',
    status: 'coming_soon',
  },
} as const;

// 서울 기준 어트랙션 (서울에서 갈 수 있는 유명 관광지)
export const ATTRACTIONS = {
  // 궁궐
  gyeongbokgung: {
    label: 'Gyeongbokgung Palace',
    labelKo: '경복궁',
    region: 'seoul',
    category: 'palace',
    description: 'The largest of the Five Grand Palaces, featuring stunning traditional architecture',
    imageUrl: 'https://images.unsplash.com/photo-1546874177-9e664107314e?w=400',
  },
  // 전통 마을
  bukchon: {
    label: 'Bukchon Hanok Village',
    labelKo: '북촌 한옥마을',
    region: 'seoul',
    category: 'traditional',
    description: 'Traditional Korean houses (hanoks) dating back 600 years',
    imageUrl: 'https://images.unsplash.com/photo-1534274867514-d5b47ef89ed7?w=400',
  },
  // 랜드마크
  n_tower: {
    label: 'N Seoul Tower',
    labelKo: 'N서울타워',
    region: 'seoul',
    category: 'landmark',
    description: 'Iconic tower with panoramic views of Seoul',
    imageUrl: 'https://images.unsplash.com/photo-1506816561089-5cc37b3aa9b0?w=400',
  },
  // 트렌디
  hongdae: {
    label: 'Hongdae',
    labelKo: '홍대',
    region: 'seoul',
    category: 'trendy',
    description: 'Vibrant area known for indie music, art, and nightlife',
    imageUrl: 'https://images.unsplash.com/photo-1517154421773-0529f29ea451?w=400',
  },
  // 시장
  gwangjang: {
    label: 'Gwangjang Market',
    labelKo: '광장시장',
    region: 'seoul',
    category: 'market',
    description: 'Historic market famous for Korean street food',
    imageUrl: 'https://images.unsplash.com/photo-1583167617820-14de7c0c97e4?w=400',
  },
  // 서울 근교 (당일치기)
  dmz: {
    label: 'DMZ',
    labelKo: 'DMZ',
    region: 'gyeonggi',
    category: 'day_trip',
    description: 'Historic border area between North and South Korea',
    imageUrl: 'https://images.unsplash.com/photo-1548115184-bc6544d06a58?w=400',
  },
  nami_island: {
    label: 'Nami Island',
    labelKo: '남이섬',
    region: 'gangwon',
    category: 'day_trip',
    description: 'Scenic island famous for tree-lined paths and K-drama filming',
    imageUrl: 'https://images.unsplash.com/photo-1548115184-bc6544d06a58?w=400',
  },
} as const;

export const BUDGET_RANGES = {
  '50-100': { label: '$50 - $100 per person', labelKo: '1인당 $50 - $100', min: 50, max: 100 },
  '100-200': { label: '$100 - $200 per person', labelKo: '1인당 $100 - $200', min: 100, max: 200 },
  '200-300': { label: '$200 - $300 per person', labelKo: '1인당 $200 - $300', min: 200, max: 300 },
  '300-500': { label: '$300 - $500 per person', labelKo: '1인당 $300 - $500', min: 300, max: 500 },
  '500+': { label: '$500+ per person', labelKo: '1인당 $500 이상', min: 500, max: null },
} as const;

export const AGE_RANGES = {
  '20s': { label: '20s', labelKo: '20대', min: 20, max: 29 },
  '30s': { label: '30s', labelKo: '30대', min: 30, max: 39 },
  '40s': { label: '40s', labelKo: '40대', min: 40, max: 49 },
  '50s': { label: '50s', labelKo: '50대', min: 50, max: 59 },
  '60+': { label: '60+', labelKo: '60대 이상', min: 60, max: null },
  mixed: { label: 'Mixed ages', labelKo: '다양한 연령대', min: null, max: null },
} as const;

export const REFERRAL_SOURCES = {
  google: { label: 'Google', labelKo: '구글' },
  tripadvisor: { label: 'TripAdvisor', labelKo: '트립어드바이저' },
  facebook: { label: 'Facebook', labelKo: '페이스북' },
  instagram: { label: 'Instagram', labelKo: '인스타그램' },
  youtube: { label: 'YouTube', labelKo: '유튜브' },
  tiktok: { label: 'TikTok', labelKo: '틱톡' },
  friend: { label: 'Friend', labelKo: '지인 추천' },
  blog: { label: 'Blog/Article', labelKo: '블로그/기사' },
  other: { label: 'Other', labelKo: '기타' },
} as const;

// Type exports
export type TourType = keyof typeof TOUR_TYPES;
export type InterestMain = keyof typeof INTEREST_MAIN;
export type InterestSub = keyof typeof INTEREST_SUB;
export type Region = keyof typeof REGIONS;
export type Attraction = keyof typeof ATTRACTIONS;
export type BudgetRange = keyof typeof BUDGET_RANGES;
export type AgeRange = keyof typeof AGE_RANGES;
export type ReferralSource = keyof typeof REFERRAL_SOURCES;
