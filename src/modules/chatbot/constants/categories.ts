export const TOUR_TYPES = {
  private: { label: 'Private Tour', labelKo: '프라이빗 투어' },
  car_only: { label: 'Private Car Only', labelKo: '차량만' },
  group: { label: 'Group Tour', labelKo: '그룹 투어' },
  multi_day: { label: 'Multi-day Tour', labelKo: '멀티데이 투어' },
  online: { label: 'Online Tour', labelKo: '온라인 투어' },
} as const;

export const INTEREST_MAIN = {
  culture: {
    label: 'Culture & History',
    labelKo: '문화/역사',
    sub: ['historical', 'museums', 'architecture', 'religion'],
  },
  entertainment: {
    label: 'Entertainment',
    labelKo: '엔터테인먼트',
    sub: ['kpop', 'kdrama', 'nightlife', 'performances'],
  },
  food: {
    label: 'Food & Lifestyle',
    labelKo: '음식/라이프스타일',
    sub: ['local_food', 'markets', 'shopping', 'like_local'],
  },
  outdoor: {
    label: 'Nature & Adventure',
    labelKo: '자연/액티비티',
    sub: ['nature', 'hiking', 'hidden_places', 'adventure'],
  },
} as const;

export const INTEREST_SUB = {
  // Culture
  historical: {
    label: 'Historical Sites',
    labelKo: '역사 유적지',
    main: 'culture',
  },
  museums: { label: 'Museums', labelKo: '박물관', main: 'culture' },
  architecture: { label: 'Architecture', labelKo: '건축물', main: 'culture' },
  religion: { label: 'Religious Sites', labelKo: '종교 시설', main: 'culture' },
  // Entertainment
  kpop: { label: 'K-pop', labelKo: '케이팝', main: 'entertainment' },
  kdrama: {
    label: 'K-drama Locations',
    labelKo: '드라마 촬영지',
    main: 'entertainment',
  },
  nightlife: {
    label: 'Nightlife',
    labelKo: '나이트라이프',
    main: 'entertainment',
  },
  performances: { label: 'Performances', labelKo: '공연', main: 'entertainment' },
  // Food
  local_food: { label: 'Local Food', labelKo: '로컬 음식', main: 'food' },
  markets: { label: 'Markets', labelKo: '시장', main: 'food' },
  shopping: { label: 'Shopping', labelKo: '쇼핑', main: 'food' },
  like_local: { label: 'Like a Local', labelKo: '현지인처럼', main: 'food' },
  // Outdoor
  nature: { label: 'Nature', labelKo: '자연', main: 'outdoor' },
  hiking: { label: 'Hiking', labelKo: '하이킹', main: 'outdoor' },
  hidden_places: {
    label: 'Hidden Places',
    labelKo: '숨은 명소',
    main: 'outdoor',
  },
  adventure: { label: 'Adventure', labelKo: '어드벤처', main: 'outdoor' },
} as const;

export const REGIONS = {
  seoul: { label: 'Seoul', labelKo: '서울' },
  busan: { label: 'Busan', labelKo: '부산' },
  jeju: { label: 'Jeju', labelKo: '제주' },
  gyeonggi: { label: 'Gyeonggi', labelKo: '경기' },
  gangwon: { label: 'Gangwon', labelKo: '강원' },
  other: { label: 'Other', labelKo: '기타' },
} as const;

export const ATTRACTIONS = {
  gyeongbokgung: { label: 'Gyeongbokgung Palace', labelKo: '경복궁' },
  dmz: { label: 'DMZ', labelKo: 'DMZ' },
  nami_island: { label: 'Nami Island', labelKo: '남이섬' },
  bukchon: { label: 'Bukchon Hanok Village', labelKo: '북촌 한옥마을' },
  n_tower: { label: 'N Seoul Tower', labelKo: 'N서울타워' },
  changdeokgung: { label: 'Changdeokgung Palace', labelKo: '창덕궁' },
  myeongdong: { label: 'Myeongdong', labelKo: '명동' },
  hongdae: { label: 'Hongdae', labelKo: '홍대' },
  insadong: { label: 'Insadong', labelKo: '인사동' },
  namsan: { label: 'Namsan', labelKo: '남산' },
} as const;

export const BUDGET_RANGES = {
  '50-100': { label: '$50 - $100', min: 50, max: 100 },
  '100-200': { label: '$100 - $200', min: 100, max: 200 },
  '200-300': { label: '$200 - $300', min: 200, max: 300 },
  '300+': { label: '$300+', min: 300, max: null },
} as const;

export const REFERRAL_SOURCES = {
  google: { label: 'Google', labelKo: '구글' },
  tripadvisor: { label: 'TripAdvisor', labelKo: '트립어드바이저' },
  facebook: { label: 'Facebook', labelKo: '페이스북' },
  instagram: { label: 'Instagram', labelKo: '인스타그램' },
  friend: { label: 'Friend', labelKo: '지인 추천' },
  other: { label: 'Other', labelKo: '기타' },
} as const;

// Type exports
export type TourType = keyof typeof TOUR_TYPES;
export type InterestMain = keyof typeof INTEREST_MAIN;
export type InterestSub = keyof typeof INTEREST_SUB;
export type Region = keyof typeof REGIONS;
export type Attraction = keyof typeof ATTRACTIONS;
export type BudgetRange = keyof typeof BUDGET_RANGES;
export type ReferralSource = keyof typeof REFERRAL_SOURCES;
