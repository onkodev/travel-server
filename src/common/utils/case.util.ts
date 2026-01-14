/**
 * snake_case를 camelCase로 변환
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * 객체의 키를 snake_case에서 camelCase로 변환
 */
export function toCamelCase<T>(obj: any): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => toCamelCase(item)) as T;
  }

  if (typeof obj === 'object') {
    const result: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const camelKey = snakeToCamel(key);
        result[camelKey] = toCamelCase(obj[key]);
      }
    }
    return result as T;
  }

  return obj;
}

/**
 * camelCase를 snake_case로 변환
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * 객체의 키를 camelCase에서 snake_case로 변환
 */
export function toSnakeCase<T>(obj: any): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => toSnakeCase(item)) as T;
  }

  if (typeof obj === 'object') {
    const result: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const snakeKey = camelToSnake(key);
        result[snakeKey] = toSnakeCase(obj[key]);
      }
    }
    return result as T;
  }

  return obj;
}
