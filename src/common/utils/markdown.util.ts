/**
 * Plain URL → Markdown 링크 변환 유틸리티
 *
 * AI 응답에 포함된 plain URL을 클릭 가능한 마크다운 링크로 변환한다.
 * AI가 자체적으로 생성한 마크다운 링크도 정규화하여 일관된 포맷 보장.
 */

/**
 * 마크다운 링크 [text](url) → plain URL로 복원
 * AI(LLM)가 자체적으로 마크다운 링크를 생성한 경우 정규화용
 */
export function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$2');
}

/**
 * 텍스트 내 plain URL을 마크다운 링크로 변환
 * - `https://example.com/path` → `[example.com/path](https://example.com/path)`
 * - 이미 `[text](url)` 형태인 경우 무시
 */
export function formatUrlsAsMarkdown(text: string): string {
  // ](url) 패턴(마크다운 링크 타겟)은 건너뛰기 위해 negative lookbehind 사용
  return text.replace(
    /(?<!\]\()https?:\/\/[^\s)>\]]+/g,
    (matched) => {
      // 문장 끝 구두점(. , ; ! ?)이 URL에 붙었으면 분리
      const trailingMatch = matched.match(/[.,;!?]+$/);
      const url = trailingMatch ? matched.slice(0, -trailingMatch[0].length) : matched;
      const trailing = trailingMatch ? trailingMatch[0] : '';

      try {
        const { hostname, pathname } = new URL(url);
        const cleanHost = hostname.replace(/^www\./, '');
        const path = pathname !== '/' ? pathname.replace(/\/$/, '') : '';
        const display = path
          ? `${cleanHost}${path.length > 30 ? path.substring(0, 30) + '...' : path}`
          : cleanHost;
        return `[${display}](${url})${trailing}`;
      } catch {
        return matched;
      }
    },
  );
}
