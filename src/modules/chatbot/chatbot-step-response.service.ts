import { Injectable } from '@nestjs/common';
import {
  TOUR_TYPES,
  INTEREST_MAIN,
  INTEREST_SUB,
  REGIONS,
  ATTRACTIONS,
  BUDGET_RANGES,
  AGE_RANGES,
} from './constants/categories';
import { StepResponseDto } from './dto/step-response.dto';
import { formatDateISO } from '../../common/utils';

/**
 * 챗봇 스텝별 응답 DTO 생성 서비스
 * 각 스텝의 질문/선택지/폼 정의를 담당 (순수 함수, DB 접근 없음)
 */
@Injectable()
export class ChatbotStepResponseService {
  // Step 1: 투어 타입
  getStep1(flow: { tourType: string | null }): StepResponseDto {
    return {
      step: 1,
      title: 'What kind of tour are you looking for?',
      titleKo: '어떤 투어를 찾고 계신가요?',
      type: 'single_select',
      required: true,
      options: Object.entries(TOUR_TYPES).map(([value, data]) => ({
        value,
        label: data.label,
        labelKo: data.labelKo,
        description: data.description,
        descriptionKo: data.descriptionKo,
        status: data.status,
        redirectUrl: data.redirectUrl,
      })),
      currentValue: flow.tourType,
    };
  }

  // Step 2: 첫 방문 여부
  getStep2(flow: { isFirstVisit: boolean | null }): StepResponseDto {
    return {
      step: 2,
      title: 'Is this your first time visiting Korea?',
      titleKo: '한국 첫 방문이신가요?',
      type: 'boolean',
      required: true,
      options: [
        {
          value: 'true',
          label: 'Yes, first time!',
          labelKo: '네, 처음이에요!',
        },
        {
          value: 'false',
          label: "No, I've been before",
          labelKo: '아니요, 방문한 적 있어요',
        },
      ],
      currentValue: flow.isFirstVisit,
    };
  }

  // Step 3: 관심사 (메인)
  getStep3Main(flow: { interestMain: string[] }): StepResponseDto {
    return {
      step: 3,
      subStep: 'main',
      title: 'What are you interested in?',
      titleKo: '어떤 것에 관심이 있으신가요?',
      type: 'multi_select',
      required: true,
      options: Object.entries(INTEREST_MAIN).map(([value, data]) => ({
        value,
        label: data.label,
        labelKo: data.labelKo,
      })),
      currentValue: flow.interestMain,
    };
  }

  // Step 3: 관심사 (서브)
  getStep3Sub(flow: {
    interestMain: string[];
    interestSub: string[];
  }): StepResponseDto {
    const selectedMains = flow.interestMain || [];
    const subOptions = Object.entries(INTEREST_SUB)
      .filter(([, data]) => selectedMains.includes(data.main))
      .map(([value, data]) => ({
        value,
        label: data.label,
        labelKo: data.labelKo,
        main: data.main,
      }));

    return {
      step: 3,
      subStep: 'sub',
      title: 'What specifically interests you?',
      titleKo: '구체적으로 어떤 것에 관심이 있으신가요?',
      type: 'multi_select',
      required: true,
      options: subOptions,
      currentValue: flow.interestSub,
    };
  }

  // Step 4: 지역
  getStep4(flow: { region: string | null }): StepResponseDto {
    return {
      step: 4,
      title: 'Which region would you like to visit?',
      titleKo: '어느 지역을 방문하고 싶으신가요?',
      type: 'single_select',
      required: true,
      options: Object.entries(REGIONS).map(([value, data]) => ({
        value,
        label: data.label,
        labelKo: data.labelKo,
        status: data.status,
      })),
      currentValue: flow.region,
    };
  }

  // Step 5: Attractions (filtered by selected region)
  getStep5(flow: {
    region: string | null;
    attractions: string[];
  }): StepResponseDto {
    const selectedRegion = flow.region;
    const filteredAttractions = Object.entries(ATTRACTIONS).filter(
      ([, data]) => {
        if (!selectedRegion) {
          return true;
        }
        if (selectedRegion === 'seoul') {
          return data.region === 'seoul' || data.category === 'day_trip';
        }
        return data.region === selectedRegion;
      },
    );

    return {
      step: 5,
      title: 'Any specific places you want to visit?',
      titleKo: '방문하고 싶은 특정 장소가 있으신가요?',
      type: 'multi_select',
      required: false,
      options: filteredAttractions.map(([value, data]) => ({
        value,
        label: data.label,
        labelKo: data.labelKo,
        category: data.category,
        region: data.region,
      })),
      currentValue: flow.attractions,
    };
  }

  // Step 6: 인적사항 + 여행 정보 (통합)
  getStep6(flow: {
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    nationality: string | null;
    travelDate: Date | null;
    duration: number | null;
    adultsCount: number | null;
    childrenCount: number | null;
    infantsCount: number | null;
    seniorsCount: number | null;
    ageRange: string | null;
    budgetRange: string | null;
    needsPickup: boolean | null;
    additionalNotes: string | null;
  }): StepResponseDto {
    return {
      step: 6,
      title: 'Tell us about yourself and your trip',
      titleKo: '고객님과 여행 정보를 알려주세요',
      type: 'form',
      required: true,
      fields: [
        // 인적사항 섹션
        {
          name: 'customerName',
          type: 'text',
          label: 'Your Name',
          labelKo: '이름',
          required: true,
          section: 'personal',
        },
        {
          name: 'customerEmail',
          type: 'email',
          label: 'Email',
          labelKo: '이메일',
          required: true,
          section: 'personal',
        },
        {
          name: 'customerPhone',
          type: 'tel',
          label: 'Phone',
          labelKo: '전화번호',
          section: 'personal',
        },
        {
          name: 'nationality',
          type: 'text',
          label: 'Nationality',
          labelKo: '국적',
          section: 'personal',
        },
        // 여행 정보 섹션
        {
          name: 'travelDate',
          type: 'date',
          label: 'Travel Date',
          labelKo: '여행 시작일',
          required: true,
          section: 'travel',
        },
        {
          name: 'duration',
          type: 'number',
          label: 'Duration (days)',
          labelKo: '여행 일수',
          required: true,
          section: 'travel',
        },
        // 인원 정보 섹션
        {
          name: 'adultsCount',
          type: 'number',
          label: 'Adults (13-64)',
          labelKo: '성인 (13-64세)',
          default: 1,
          section: 'group',
        },
        {
          name: 'childrenCount',
          type: 'number',
          label: 'Children (3-12)',
          labelKo: '어린이 (3-12세)',
          default: 0,
          section: 'group',
        },
        {
          name: 'infantsCount',
          type: 'number',
          label: 'Infants (0-2)',
          labelKo: '유아 (0-2세)',
          default: 0,
          section: 'group',
        },
        {
          name: 'seniorsCount',
          type: 'number',
          label: 'Seniors (65+)',
          labelKo: '시니어 (65세 이상)',
          default: 0,
          section: 'group',
        },
        {
          name: 'ageRange',
          type: 'select',
          label: 'Primary Age Group',
          labelKo: '주요 연령대',
          section: 'group',
          options: Object.entries(AGE_RANGES).map(([value, data]) => ({
            value,
            label: data.label,
            labelKo: data.labelKo,
          })),
        },
        // 예산 및 기타 섹션
        {
          name: 'budgetRange',
          type: 'select',
          label: 'Budget per person',
          labelKo: '1인당 예산',
          section: 'budget',
          options: Object.entries(BUDGET_RANGES).map(([value, data]) => ({
            value,
            label: data.label,
            labelKo: data.labelKo,
          })),
        },
        {
          name: 'needsPickup',
          type: 'boolean',
          label: 'Airport pickup needed?',
          labelKo: '공항 픽업 필요?',
          section: 'budget',
        },
        // 추가 요청사항
        {
          name: 'additionalNotes',
          type: 'textarea',
          label: 'Any special requests? (e.g., wheelchair, allergies)',
          labelKo: '추가 요청사항 (예: 휠체어, 알레르기)',
          section: 'notes',
        },
      ],
      currentValue: {
        customerName: flow.customerName,
        customerEmail: flow.customerEmail,
        customerPhone: flow.customerPhone,
        nationality: flow.nationality,
        travelDate: flow.travelDate,
        duration: flow.duration,
        adultsCount: flow.adultsCount,
        childrenCount: flow.childrenCount,
        infantsCount: flow.infantsCount,
        seniorsCount: flow.seniorsCount,
        ageRange: flow.ageRange,
        budgetRange: flow.budgetRange,
        needsPickup: flow.needsPickup,
        additionalNotes: flow.additionalNotes,
      },
    };
  }

  /**
   * 챗봇 설문 응답 요약 생성 (이메일 발송용)
   */
  buildSurveySummary(flow: {
    tourType: string | null;
    isFirstVisit: boolean | null;
    interestMain: string[];
    interestSub: string[];
    region: string | null;
    attractions: string[];
    travelDate: Date | null;
    duration: number | null;
    adultsCount: number | null;
    childrenCount: number | null;
    infantsCount: number | null;
    seniorsCount: number | null;
    budgetRange: string | null;
    needsPickup: boolean | null;
    nationality: string | null;
    additionalNotes: string | null;
  }): string {
    const lines: string[] = ['[Chatbot Survey Summary]', ''];

    if (flow.tourType) {
      const tourTypeLabel =
        TOUR_TYPES[flow.tourType as keyof typeof TOUR_TYPES]?.label ||
        flow.tourType;
      lines.push(`• Tour Type: ${tourTypeLabel}`);
    }

    if (flow.isFirstVisit !== null) {
      lines.push(`• First Visit to Korea: ${flow.isFirstVisit ? 'Yes' : 'No'}`);
    }

    if (flow.interestMain.length > 0) {
      const mainLabels = flow.interestMain.map(
        (val) => INTEREST_MAIN[val as keyof typeof INTEREST_MAIN]?.label || val,
      );
      lines.push(`• Main Interests: ${mainLabels.join(', ')}`);
    }

    if (flow.interestSub.length > 0) {
      const subLabels = flow.interestSub.map(
        (val) => INTEREST_SUB[val as keyof typeof INTEREST_SUB]?.label || val,
      );
      lines.push(`• Specific Interests: ${subLabels.join(', ')}`);
    }

    if (flow.region) {
      const regionLabel =
        REGIONS[flow.region as keyof typeof REGIONS]?.label || flow.region;
      lines.push(`• Region: ${regionLabel}`);
    }

    if (flow.attractions.length > 0) {
      const attractionLabels = flow.attractions.map(
        (val) => ATTRACTIONS[val as keyof typeof ATTRACTIONS]?.label || val,
      );
      lines.push(`• Must-see Places: ${attractionLabels.join(', ')}`);
    }

    lines.push('');
    lines.push('[Travel Details]');

    if (flow.travelDate) {
      lines.push(
        `• Travel Date: ${formatDateISO(flow.travelDate)}`,
      );
    }

    if (flow.duration) {
      lines.push(`• Duration: ${flow.duration} day(s)`);
    }

    const travelers: string[] = [];
    if (flow.adultsCount) travelers.push(`${flow.adultsCount} Adult(s)`);
    if (flow.childrenCount) travelers.push(`${flow.childrenCount} Child(ren)`);
    if (flow.infantsCount) travelers.push(`${flow.infantsCount} Infant(s)`);
    if (flow.seniorsCount) travelers.push(`${flow.seniorsCount} Senior(s)`);
    if (travelers.length > 0) {
      lines.push(`• Group: ${travelers.join(', ')}`);
    }

    if (flow.budgetRange) {
      const budgetLabel =
        BUDGET_RANGES[flow.budgetRange as keyof typeof BUDGET_RANGES]?.label ||
        flow.budgetRange;
      lines.push(`• Budget: ${budgetLabel}`);
    }

    if (flow.needsPickup !== null) {
      lines.push(`• Airport Pickup: ${flow.needsPickup ? 'Yes' : 'No'}`);
    }

    if (flow.nationality) {
      lines.push(`• Nationality: ${flow.nationality}`);
    }

    if (flow.additionalNotes) {
      lines.push('');
      lines.push('[Additional Notes]');
      lines.push(flow.additionalNotes);
    }

    return lines.join('\n');
  }
}
