import { Logger } from '@nestjs/common';

const logger = new Logger('ResponseParser');

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
      return null;
    };

    // 배열 먼저 시도 (defaultValue가 배열인 경우)
    if (Array.isArray(defaultValue)) {
      const arrayStr = extractJson(jsonStr, '[', ']');
      if (arrayStr) {
        return JSON.parse(arrayStr);
      }
    }

    // JSON 객체 추출
    const objStr = extractJson(jsonStr, '{', '}');
    if (objStr) {
      return JSON.parse(objStr);
    }

    // 배열을 기본값으로 사용하지 않는 경우에도 배열 시도
    const arrayStr = extractJson(jsonStr, '[', ']');
    if (arrayStr) {
      return JSON.parse(arrayStr);
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
