/**
 * Plain URL → Markdown 링크 변환 유틸리티
 *
 * AI 응답에 포함된 plain URL을 클릭 가능한 마크다운 링크로 변환한다.
 * 이미 마크다운 형식인 [text](url)은 건드리지 않는다.
 */

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
