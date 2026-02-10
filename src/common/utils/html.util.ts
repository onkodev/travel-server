const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const HTML_ESCAPE_REGEX = /[&<>"']/g;

export function escapeHtml(str: string): string {
  return str.replace(HTML_ESCAPE_REGEX, (ch) => HTML_ESCAPE_MAP[ch]);
}
