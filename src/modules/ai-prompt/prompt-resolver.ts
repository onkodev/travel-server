/**
 * 템플릿 변수 치환 유틸리티
 * {{key}} → 값 치환, 빈 줄 정리
 */
export function resolveTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }

  // 남은 {{변수}} 제거 (빈 값)
  result = result.replace(/\{\{[^}]+\}\}/g, '');

  // 연속 빈 줄 2개 이상 → 1개로 정리
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}
