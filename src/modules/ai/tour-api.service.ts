import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { FileUploadService } from '../file-upload/file-upload.service';

export interface TourAPISearchItem {
  contentId: string;
  contentTypeId: string;
  title: string;
  titleEng?: string;
  address: string;
  addressEng?: string;
  lat: number;
  lng: number;
  thumbnail?: string;
  tel?: string;
  type: string;
  exists: boolean;
}

// 한국관광공사 API raw 응답 아이템 타입
interface TourAPIRawItem {
  contentid: string;
  contenttypeid: string;
  title: string;
  addr1?: string;
  addr2?: string;
  mapx?: string;
  mapy?: string;
  firstimage?: string;
  firstimage2?: string;
  tel?: string;
  areacode?: string;
  sigungucode?: string;
  cat1?: string;
  cat2?: string;
  cat3?: string;
}

// 콘텐츠 타입 ID → 내부 타입 매핑
const CONTENT_TYPE_MAP: Record<string, string> = {
  '12': 'place',        // 관광지
  '14': 'place',        // 문화시설
  '15': 'contents',     // 축제/공연/행사
  '25': 'place',        // 여행코스
  '28': 'contents',     // 레포츠
  '32': 'accommodation', // 숙박
  '38': 'place',        // 쇼핑
  '39': 'contents',     // 음식점
};

@Injectable()
export class TourApiService {
  private readonly logger = new Logger(TourApiService.name);
  private apiKey: string;
  private baseUrlKor = 'https://apis.data.go.kr/B551011/KorService2';
  private baseUrlEng = 'https://apis.data.go.kr/B551011/EngService2';

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private fileUploadService: FileUploadService,
  ) {
    this.apiKey = this.configService.get<string>('TOUR_API_KEY') || '';
  }

  // 공통 파라미터
  private getCommonParams(additionalParams: Record<string, string> = {}) {
    return new URLSearchParams({
      serviceKey: this.apiKey,
      MobileOS: 'ETC',
      MobileApp: 'tumakr',
      _type: 'json',
      ...additionalParams,
    });
  }

  // 한국어 검색
  private async searchKorean(keyword: string, contentTypeId?: string): Promise<TourAPIRawItem[]> {
    const params = this.getCommonParams({
      keyword,
      numOfRows: '20',
      pageNo: '1',
    });
    if (contentTypeId) params.append('contentTypeId', contentTypeId);

    try {
      const response = await fetch(`${this.baseUrlKor}/searchKeyword2?${params}`);
      if (!response.ok) {
        this.logger.error(`Tour API error: ${response.status} ${response.statusText}`);
        return [];
      }

      const data = await response.json();
      if (data?.response?.header?.resultCode !== '0000') {
        this.logger.error(`Tour API: ${data?.response?.header?.resultMsg || 'Unknown error'}`);
        return [];
      }

      const items = data?.response?.body?.items?.item || [];
      return Array.isArray(items) ? items : [items];
    } catch (error) {
      this.logger.error('Tour API request failed:', error);
      return [];
    }
  }

  // 영어 데이터 위치 기반 검색
  private async searchEnglishByLocation(mapX: number, mapY: number): Promise<TourAPIRawItem[]> {
    const params = this.getCommonParams({
      mapX: mapX.toString(),
      mapY: mapY.toString(),
      radius: '500',
      numOfRows: '10',
      pageNo: '1',
    });

    try {
      const response = await fetch(`${this.baseUrlEng}/locationBasedList2?${params}`);
      if (!response.ok) return [];

      const data = await response.json();
      if (data?.response?.header?.resultCode !== '0000') return [];

      const items = data?.response?.body?.items?.item || [];
      return Array.isArray(items) ? items : [items];
    } catch {
      return [];
    }
  }

  // 영어 매칭 찾기
  private findBestEngMatch(korItem: TourAPIRawItem, engItems: TourAPIRawItem[]): TourAPIRawItem | null {
    // 정확한 지역 + 카테고리 매칭
    for (const item of engItems) {
      if (
        korItem.areacode === item.areacode &&
        korItem.sigungucode === item.sigungucode &&
        korItem.cat1 === item.cat1 &&
        korItem.cat2 === item.cat2 &&
        korItem.cat3 === item.cat3
      ) {
        return item;
      }
    }

    // 지역 매칭
    for (const item of engItems) {
      if (
        korItem.areacode === item.areacode &&
        korItem.sigungucode === item.sigungucode
      ) {
        return item;
      }
    }

    return engItems[0] || null;
  }

  // 한국 관광 API 검색 (기본)
  async search(params: {
    keyword?: string;
    areaCode?: string;
    contentTypeId?: string;
    pageNo?: number;
  }): Promise<any[]> {
    const { keyword, areaCode, contentTypeId, pageNo = 1 } = params;

    if (!this.apiKey) {
      this.logger.warn('Tour API key is not configured');
      return [];
    }

    const searchParams = this.getCommonParams({
      numOfRows: '20',
      pageNo: pageNo.toString(),
    });

    let apiUrl: string;
    if (keyword) {
      searchParams.append('keyword', keyword);
      apiUrl = `${this.baseUrlKor}/searchKeyword2?${searchParams}`;
    } else {
      apiUrl = `${this.baseUrlKor}/areaBasedList2?${searchParams}`;
    }

    if (areaCode) searchParams.append('areaCode', areaCode);
    if (contentTypeId) searchParams.append('contentTypeId', contentTypeId);

    try {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        this.logger.error(`Tour API error: ${response.status} ${response.statusText}`);
        return [];
      }

      const data = await response.json();
      if (data?.response?.header?.resultCode !== '0000') {
        this.logger.error(`Tour API: ${data?.response?.header?.resultMsg || 'Unknown error'}`);
        return [];
      }

      const items = data?.response?.body?.items?.item || [];
      return Array.isArray(items) ? items : [items];
    } catch (error) {
      this.logger.error('Tour API request failed:', error);
      return [];
    }
  }

  // 검색 + DB 존재 여부 확인 + 영어 데이터
  async searchWithExistence(
    keyword: string,
    contentTypeId?: string,
  ): Promise<{ items: TourAPISearchItem[] }> {
    const korItems = await this.searchKorean(keyword, contentTypeId);

    if (!korItems.length) {
      return { items: [] };
    }

    // DB 존재 여부 확인
    const contentIds = korItems.map((item: TourAPIRawItem) => item.contentid);
    const existingItems = await this.prisma.item.findMany({
      where: { tourApiContentId: { in: contentIds } },
      select: { tourApiContentId: true },
    });
    const existingSet = new Set(existingItems.map((i) => i.tourApiContentId));

    // 영어 데이터와 함께 결과 매핑
    const mappedItems: TourAPISearchItem[] = await Promise.all(
      korItems.map(async (korItem: TourAPIRawItem) => {
        const lat = parseFloat(korItem.mapy || '0') || 0;
        const lng = parseFloat(korItem.mapx || '0') || 0;

        // 영어 데이터 찾기
        let titleEng = '';
        let addressEng = '';

        if (lat && lng) {
          const engItems = await this.searchEnglishByLocation(lng, lat);
          const engMatch = this.findBestEngMatch(korItem, engItems);
          if (engMatch) {
            titleEng = engMatch.title || '';
            addressEng = engMatch.addr1 || '';
          }
        }

        return {
          contentId: korItem.contentid,
          contentTypeId: korItem.contenttypeid,
          title: korItem.title,
          titleEng,
          address: korItem.addr1 + (korItem.addr2 || ''),
          addressEng,
          lat,
          lng,
          thumbnail: korItem.firstimage || korItem.firstimage2,
          tel: korItem.tel,
          type: CONTENT_TYPE_MAP[korItem.contenttypeid] || 'place',
          exists: existingSet.has(korItem.contentid),
        };
      }),
    );

    return { items: mappedItems };
  }

  // Tour API에서 아이템 추가
  async addItem(contentId: string, itemData: TourAPISearchItem) {
    // 이미 존재하는지 확인
    const existing = await this.prisma.item.findFirst({
      where: { tourApiContentId: contentId },
    });

    if (existing) {
      return { success: true, item: { ...itemData, id: existing.id }, isNew: false };
    }

    // 썸네일을 S3에 업로드
    let s3ImageUrl: string | null = null;
    if (itemData.thumbnail) {
      this.logger.debug(`Uploading thumbnail for ${contentId}: ${itemData.thumbnail}`);
      s3ImageUrl = await this.fileUploadService.uploadFromUrl(
        itemData.thumbnail,
        contentId,
        'items',
      );
      this.logger.debug(`S3 URL result: ${s3ImageUrl || 'failed'}`);
    } else {
      this.logger.debug(`No thumbnail for ${contentId}`);
    }

    // 새 아이템 생성
    const newItem = await this.prisma.item.create({
      data: {
        tourApiContentId: itemData.contentId,
        nameKor: itemData.title,
        nameEng: itemData.titleEng || itemData.title,
        type: itemData.type,
        address: itemData.address,
        addressEnglish: itemData.addressEng,
        lat: itemData.lat,
        lng: itemData.lng,
        images: s3ImageUrl
          ? [{ type: 'thumbnail', url: s3ImageUrl }]
          : [],
      },
    });

    return {
      success: true,
      item: { ...itemData, id: newItem.id },
      isNew: true,
    };
  }

  // 콘텐츠 타입 목록
  getContentTypes() {
    return [
      { id: '12', name: '관광지', nameEng: 'Tourist Attraction' },
      { id: '14', name: '문화시설', nameEng: 'Cultural Facility' },
      { id: '15', name: '행사/축제', nameEng: 'Festival/Event' },
      { id: '25', name: '여행코스', nameEng: 'Travel Course' },
      { id: '28', name: '레포츠', nameEng: 'Leisure Sports' },
      { id: '32', name: '숙박', nameEng: 'Accommodation' },
      { id: '38', name: '쇼핑', nameEng: 'Shopping' },
      { id: '39', name: '음식점', nameEng: 'Restaurant' },
    ];
  }

  // 지역 코드 목록
  getAreaCodes() {
    return [
      { code: '1', name: '서울' },
      { code: '2', name: '인천' },
      { code: '3', name: '대전' },
      { code: '4', name: '대구' },
      { code: '5', name: '광주' },
      { code: '6', name: '부산' },
      { code: '7', name: '울산' },
      { code: '8', name: '세종' },
      { code: '31', name: '경기도' },
      { code: '32', name: '강원도' },
      { code: '33', name: '충청북도' },
      { code: '34', name: '충청남도' },
      { code: '35', name: '경상북도' },
      { code: '36', name: '경상남도' },
      { code: '37', name: '전라북도' },
      { code: '38', name: '전라남도' },
      { code: '39', name: '제주도' },
    ];
  }
}
