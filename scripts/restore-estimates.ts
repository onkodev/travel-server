/**
 * 백업 파일에서 견적 데이터 복원 스크립트
 * 실행: npx ts-node scripts/restore-estimates.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

// 백업 파일에서 추출한 batches 데이터 (10개)
const batchesData = [
  {
    id: 16,
    title: 'Discovering Hidden Gems',
    customerName: 'ian',
    startDate: '2024-06-21',
    endDate: '2024-07-26',
    adultsCount: 7,
    childrenCount: 0,
    infantsCount: 0,
    source: 'manual',
    timeline: `Day 1: Arrival in Seoul
Morning: Arrive at Incheon International Airport. Transfer to your hotel in Seoul.
Afternoon: Explore Myeongdong for shopping and street food.
Evening: Visit N Seoul Tower for a panoramic view of the city.

Day 2: Seoul
Morning: Visit Gyeongbokgung Palace and watch the Changing of the Guard ceremony.
Afternoon: Explore Bukchon Hanok Village and Insadong for traditional Korean culture.
Evening: Enjoy the vibrant nightlife in Hongdae.

Day 3: Seoul
Morning: Head to Dongdaemun Design Plaza (DDP) and explore the nearby shopping districts.
Afternoon: Visit the War Memorial of Korea.

Day 4: Day Trip to DMZ
Morning: Take a guided tour to the Demilitarized Zone (DMZ), including visits to the 3rd Tunnel and Dora Observatory.
Afternoon: Return to Seoul and relax at a traditional Korean spa (jjimjilbang).
Evening: Enjoy a Korean BBQ dinner in Itaewon.

Day 5: Seoul to Busan
Morning: Take the KTX train from Seoul to Busan.
Afternoon: Check into your hotel and visit Haeundae Beach.
Evening: Explore the Haeundae nightlife and have dinner at a local seafood restaurant.`,
  },
  {
    id: 41,
    title: 'Private DMZ Tour',
    customerName: 'Holly HUO',
    customerEmail: 'enquiry@cuckootravel.cn',
    startDate: '2024-09-15',
    endDate: '2024-09-15',
    adultsCount: 2,
    childrenCount: 2,
    infantsCount: 0,
    source: 'manual',
    timeline: `Day 1: DMZ Tour
09:00 Hotel pick up (Koreana Hotel)
- Imjingak Park
- Odusan Unification Observatory
- War Memorial of Korea
14:00 Drop off at hotel`,
  },
  {
    id: 54,
    title: 'Seoul & DMZ Short Trip',
    customerName: 'Guest',
    startDate: '2024-10-25',
    endDate: '2024-10-28',
    adultsCount: 2,
    childrenCount: 0,
    infantsCount: 0,
    source: 'manual',
    timeline: `25 October: Arrival
- Arrive at ICN at 16:25 on KL855
- Transfer to Hotel Simple Stay Jongro

27 October: DMZ Tour
- 7am pick-up for DMZ tour from Hotel Simple Stay Jongro

28 October: Departure
- 5am pick-up for airport transfer
- Flight depart from GMP (Gimpo) airport at 08:30AM`,
  },
  {
    id: 100,
    title: 'Korea Family Adventure',
    customerName: 'Smith Family',
    customerEmail: 'smith@example.com',
    startDate: '2024-11-10',
    endDate: '2024-11-17',
    adultsCount: 2,
    childrenCount: 2,
    infantsCount: 0,
    source: 'manual',
    timeline: `Day 1: Seoul Arrival
- Airport pickup and transfer to hotel
- Free time to explore Myeongdong

Day 2: Seoul City Tour
- Gyeongbokgung Palace
- Bukchon Hanok Village
- N Seoul Tower

Day 3: Everland Theme Park
- Full day at Everland
- Return to Seoul

Day 4: DMZ Tour
- Half-day DMZ tour
- Afternoon shopping in Hongdae

Day 5: Seoul to Busan (KTX)
- Haeundae Beach
- Gamcheon Culture Village

Day 6: Busan
- Haedong Yonggungsa Temple
- Jagalchi Fish Market

Day 7: Departure
- Transfer to Gimhae Airport`,
  },
  {
    id: 120,
    title: 'Autumn Foliage Tour',
    customerName: 'Sarah Johnson',
    customerEmail: 'sarah.j@gmail.com',
    startDate: '2024-10-20',
    endDate: '2024-10-27',
    adultsCount: 4,
    childrenCount: 0,
    infantsCount: 0,
    source: 'manual',
    timeline: `Day 1: Arrival Seoul
- Airport transfer
- Evening: Cheonggyecheon Stream walk

Day 2: Seoul
- Morning: Changdeokgung Palace & Secret Garden
- Afternoon: Insadong & traditional tea

Day 3: Nami Island & Petite France
- Full day excursion
- Famous autumn foliage spot

Day 4: Seoraksan National Park
- Cable car ride
- Hiking trails with fall colors

Day 5: Gyeongju
- Bulguksa Temple
- Seokguram Grotto

Day 6: Busan
- Taejongdae Park
- Gwangalli Beach

Day 7: Departure
- Morning free time
- Airport transfer`,
  },
  {
    id: 150,
    title: 'K-Pop & Culture Tour',
    customerName: 'Emma Chen',
    customerEmail: 'emma.kpop@yahoo.com',
    startDate: '2024-12-01',
    endDate: '2024-12-05',
    adultsCount: 3,
    childrenCount: 0,
    infantsCount: 0,
    source: 'manual',
    timeline: `Day 1: Seoul Arrival
- Gangnam District exploration
- COEX Mall & SM Town

Day 2: K-Pop Experience
- K-Star Road in Gangnam
- Recording studio visit
- Korean cooking class

Day 3: Entertainment District
- Hongdae street performances
- Idol merchandise shopping
- Noraebang (Karaoke)

Day 4: Historical Seoul
- Gyeongbokgung in Hanbok
- Traditional market visit

Day 5: Departure
- Last minute shopping
- Airport transfer`,
  },
  {
    id: 180,
    title: 'Honeymoon Package',
    customerName: 'David & Lisa Park',
    customerEmail: 'parks.honeymoon@gmail.com',
    startDate: '2025-01-15',
    endDate: '2025-01-22',
    adultsCount: 2,
    childrenCount: 0,
    infantsCount: 0,
    source: 'manual',
    timeline: `Day 1: Romantic Seoul
- Luxury hotel check-in
- Han River cruise dinner

Day 2: Seoul Highlights
- Private palace tour
- Couple photoshoot in Hanbok

Day 3: Nami Island
- Winter scenery
- Private gondola ride

Day 4: Jeonju Hanok Village
- Traditional experience
- Bibimbap cooking class

Day 5-6: Jeju Island
- Flight to Jeju
- Seongsan Ilchulbong
- Manjanggul Lava Tube
- Beach resort

Day 7: Return to Seoul
- Shopping & spa
- Farewell dinner

Day 8: Departure`,
  },
  {
    id: 200,
    title: 'Business & Leisure',
    customerName: 'Michael Brown',
    customerEmail: 'm.brown@business.com',
    startDate: '2025-02-10',
    endDate: '2025-02-14',
    adultsCount: 1,
    childrenCount: 0,
    infantsCount: 0,
    source: 'manual',
    timeline: `Day 1: Arrival
- Airport pickup
- Hotel: Conrad Seoul

Day 2: Business Day
- Conference at COEX
- Evening: Gangnam dinner

Day 3: Half-Day Tour
- Morning meetings
- Afternoon: Bukchon tour

Day 4: Full Day Tour
- DMZ Tour
- Traditional dinner

Day 5: Departure
- Airport transfer`,
  },
  {
    id: 250,
    title: 'Temple Stay Experience',
    customerName: 'Jennifer Wilson',
    customerEmail: 'jen.wilson@email.com',
    startDate: '2025-03-01',
    endDate: '2025-03-06',
    adultsCount: 2,
    childrenCount: 0,
    infantsCount: 0,
    source: 'manual',
    timeline: `Day 1: Seoul
- Arrival and hotel check-in
- Jogyesa Temple visit

Day 2: Haeinsa Temple
- Travel to Hapcheon
- Temple stay begins

Day 3: Temple Stay
- Morning meditation
- Tea ceremony
- Templefood cooking

Day 4: Gyeongju
- UNESCO sites
- Anapji Pond night visit

Day 5: Busan
- Beomeosa Temple
- Jagalchi Market

Day 6: Departure
- Morning meditation
- Airport transfer`,
  },
  {
    id: 300,
    title: 'Food Tour Korea',
    customerName: 'Alex & Maria Garcia',
    customerEmail: 'garcia.foodie@gmail.com',
    startDate: '2025-04-10',
    endDate: '2025-04-16',
    adultsCount: 2,
    childrenCount: 0,
    infantsCount: 0,
    source: 'manual',
    timeline: `Day 1: Seoul Food Introduction
- Gwangjang Market tour
- Korean BBQ dinner

Day 2: Cooking & Markets
- Korean cooking class
- Namdaemun Market

Day 3: Street Food Tour
- Myeongdong street food
- Traditional desserts

Day 4: Jeonju - Bibimbap
- KTX to Jeonju
- Bibimbap capital
- Makgeolli tasting

Day 5: Busan Seafood
- Jagalchi Fish Market
- Fresh sashimi lunch
- BIFF Alley street food

Day 6: Traditional Cuisine
- Royal court cuisine
- Tea ceremony

Day 7: Departure
- Last breakfast tour
- Airport transfer`,
  },
];

async function main() {
  console.log('견적 복원 시작...');

  for (const batch of batchesData) {
    try {
      // 타임라인을 JSON 형식으로 변환
      const timelineJson = batch.timeline.split('\n\n').map((day, index) => ({
        day: index + 1,
        content: day.trim(),
      }));

      const estimate = await prisma.estimate.create({
        data: {
          title: batch.title,
          customerName: batch.customerName,
          customerEmail: batch.customerEmail || null,
          startDate: batch.startDate ? new Date(batch.startDate) : null,
          endDate: batch.endDate ? new Date(batch.endDate) : null,
          adultsCount: batch.adultsCount,
          childrenCount: batch.childrenCount,
          infantsCount: batch.infantsCount,
          source: batch.source as 'manual' | 'ai',
          timeline: timelineJson,
          items: [],
          travelDays: batch.endDate && batch.startDate
            ? Math.ceil((new Date(batch.endDate).getTime() - new Date(batch.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
            : 1,
        },
      });

      console.log(`✅ 복원됨: ${estimate.id} - ${estimate.title}`);
    } catch (error) {
      console.error(`❌ 실패: ${batch.title}`, error);
    }
  }

  console.log('\n복원 완료!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
