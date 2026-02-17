import { Logger } from '@nestjs/common';

const logger = new Logger('ResponseParser');

/**
 * JSON 문자열에서 잘못된 이스케이프/제어 문자 제거
 * Gemini가 가끔 생성하는 `\#`, `\/`, 제어 문자 등을 정리합니다.
 */
function sanitizeJsonString(str: string): string {
  // 1) 문자열 리터럴 내부의 제어 문자 (0x00-0x1F) 제거 (탭/줄바꿈 제외)
  let result = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // 2) 잘못된 이스케이프 시퀀스 수정: 유효한 이스케이프(\", \\, \/, \b, \f, \n, \r, \t, \uXXXX)가 아닌 것 → 백슬래시 제거
  result = result.replace(
    /\\(?!["\\/bfnrtu])/g,
    '',
  );

  return result;
}

/**
 * 잘린 JSON 배열/객체를 닫아서 파싱 가능하게 복구 시도
 */
function tryRepairTruncatedJson(str: string): string | null {
  // 열린 괄호 수 세기
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;

  for (const ch of str) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
  }

  if (braces === 0 && brackets === 0) return null; // 이미 균형 맞음

  // 마지막 불완전한 항목 제거 (마지막 완전한 }, 이후 잘라내기)
  let repaired = str;
  if (braces > 0 || brackets > 0) {
    const lastCompleteObj = str.lastIndexOf('}');
    const lastComma = str.lastIndexOf(',', lastCompleteObj);
    if (lastComma > 0 && lastCompleteObj > 0) {
      // 마지막 완전한 객체까지만 유지
      repaired = str.substring(0, lastCompleteObj + 1);
    }
  }

  // 닫는 괄호 추가
  while (braces > 0) { repaired += '}'; braces--; }
  while (brackets > 0) { repaired += ']'; brackets--; }

  return repaired;
}

/**
 * JSON.parse를 시도하되, 실패 시 sanitize → repair 순으로 재시도
 */
function safeParse(str: string): unknown {
  // 1차: 원본 그대로
  try { return JSON.parse(str); } catch { /* continue */ }

  // 2차: sanitize 후 재시도
  const sanitized = sanitizeJsonString(str);
  try { return JSON.parse(sanitized); } catch { /* continue */ }

  // 3차: 잘린 JSON 복구 시도
  const repaired = tryRepairTruncatedJson(sanitized);
  if (repaired) {
    try { return JSON.parse(repaired); } catch { /* continue */ }
  }

  throw new Error('All JSON parse attempts failed');
}

/**
 * JSON 응답 파싱 유틸리티
 * 마크다운 코드 블록과 다양한 형식의 JSON 응답을 처리합니다.
 */
export function parseJsonResponse<T>(text: string, defaultValue: T): T {
  try {
    let jsonStr = text;

    // 마크다운 코드 블록 제거 (```json ... ``` 또는 ``` ... ```)
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      // 닫는 ``` 없이 잘린 마크다운 펜스 처리
      const openFenceMatch = text.match(/```(?:json)?\s*([\s\S]*)/);
      if (openFenceMatch) {
        jsonStr = openFenceMatch[1].trim();
      }
    }

    // 중첩된 JSON 추출 헬퍼 (괄호 매칭)
    const extractJson = (
      str: string,
      startChar: string,
      endChar: string,
    ): string | null => {
      const startIdx = str.indexOf(startChar);
      if (startIdx === -1) return null;

      let depth = 0;
      for (let i = startIdx; i < str.length; i++) {
        if (str[i] === startChar) depth++;
        if (str[i] === endChar) depth--;
        if (depth === 0) {
          return str.substring(startIdx, i + 1);
        }
      }
      // 괄호가 안 닫힌 경우 (잘린 JSON) → 시작부터 끝까지 반환
      return str.substring(startIdx);
    };

    // 배열 먼저 시도 (defaultValue가 배열인 경우)
    if (Array.isArray(defaultValue)) {
      const arrayStr = extractJson(jsonStr, '[', ']');
      if (arrayStr) {
        const parsed = safeParse(arrayStr);
        if (Array.isArray(parsed)) return parsed as T;
        // 배열이 아닌 경우 배열로 래핑
        if (parsed && typeof parsed === 'object') return [parsed] as T;
      }
    }

    // JSON 객체 추출
    const objStr = extractJson(jsonStr, '{', '}');
    if (objStr) {
      return safeParse(objStr) as T;
    }

    // 배열을 기본값으로 사용하지 않는 경우에도 배열 시도
    const arrayStr = extractJson(jsonStr, '[', ']');
    if (arrayStr) {
      return safeParse(arrayStr) as T;
    }
  } catch (e) {
    logger.error('JSON 파싱 실패:', e);
    logger.error('원본 텍스트:', text.substring(0, 500));
  }
  return defaultValue;
}

/**
 * 응답에서 JSON 블록과 텍스트를 분리합니다.
 */
export function extractJsonAndText(text: string): {
  textContent: string;
  jsonContent: unknown | null;
} {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);

  if (jsonMatch) {
    const textContent = text.replace(/```json\s*[\s\S]*?```/, '').trim();
    try {
      const jsonContent = JSON.parse(jsonMatch[1].trim());
      return { textContent, jsonContent };
    } catch {
      return { textContent: text, jsonContent: null };
    }
  }

  return { textContent: text, jsonContent: null };
}
