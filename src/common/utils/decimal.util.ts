/**
 * Prisma Decimal 필드를 숫자로 변환하는 유틸리티
 * Prisma는 Decimal 타입을 문자열 또는 Decimal 객체로 반환하므로
 * 프론트엔드에서 사용하기 위해 숫자로 변환해야 함
 */

const DECIMAL_FIELDS = [
  'price',
  'lat',
  'lng',
  'latitude',
  'longitude',
  'averageRating',
  'rating',
  'totalAmount',
  'unitPrice',
  'subtotal',
  'manualAdjustment',
  'paidAmount',
  'weekdayPrice',
  'weekendPrice',
  'amount',
  'refundedAmount',
];

export function convertDecimalFields<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(convertDecimalFields) as T;
  if (typeof obj !== 'object') return obj;

  const converted: any = {};
  for (const key of Object.keys(obj as object)) {
    const value = (obj as any)[key];

    if (
      value !== null &&
      typeof value === 'object' &&
      typeof value.toNumber === 'function'
    ) {
      // Prisma Decimal object
      converted[key] = value.toNumber();
    } else if (typeof value === 'string' && DECIMAL_FIELDS.includes(key)) {
      // String that should be number
      const parsed = parseFloat(value);
      converted[key] = isNaN(parsed) ? 0 : parsed;
    } else if (value instanceof Date) {
      converted[key] = value;
    } else if (typeof value === 'object' && value !== null) {
      converted[key] = convertDecimalFields(value);
    } else {
      converted[key] = value;
    }
  }
  return converted as T;
}

export function convertDecimalList<T>(items: T[]): T[] {
  return items.map(convertDecimalFields);
}
