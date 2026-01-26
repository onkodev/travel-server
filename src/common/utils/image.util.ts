/**
 * Image utility functions
 * - Normalize image data to consistent format
 */

export interface ImageObject {
  url: string;
  type?: string;
}

/**
 * Normalize images to { url: string }[] format
 * Handles various input formats:
 * - string[] → [{ url: string }]
 * - { url: string }[] → pass through
 * - null/undefined → []
 */
export function normalizeImages(images: unknown): ImageObject[] {
  if (!images) return [];
  if (!Array.isArray(images)) return [];

  return images
    .map((img): ImageObject | null => {
      // Already in object format
      if (typeof img === 'object' && img !== null && 'url' in img) {
        const objImg = img as { url: string; type?: string };
        return { url: objImg.url, type: objImg.type };
      }
      // String format
      if (typeof img === 'string' && img.length > 0) {
        return { url: img };
      }
      return null;
    })
    .filter((img): img is ImageObject => img !== null);
}

/**
 * Extract image URLs as string array
 * Useful for cases where only URLs are needed
 */
export function extractImageUrls(images: unknown): string[] {
  if (!images) return [];
  if (!Array.isArray(images)) return [];

  return images
    .map((img): string | null => {
      if (typeof img === 'string') return img;
      if (typeof img === 'object' && img !== null && 'url' in img) {
        return (img as { url: string }).url;
      }
      return null;
    })
    .filter((url): url is string => Boolean(url));
}
