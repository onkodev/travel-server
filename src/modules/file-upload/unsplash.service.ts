import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface UnsplashImage {
  id: string;
  urls: {
    raw: string;
    full: string;
    regular: string;
    small: string;
    thumb: string;
  };
  alt_description: string | null;
  user: {
    name: string;
    username: string;
  };
}

export interface UnsplashSearchResponse {
  total: number;
  total_pages: number;
  results: UnsplashImage[];
}

@Injectable()
export class UnsplashService {
  private readonly logger = new Logger(UnsplashService.name);
  private readonly apiUrl = 'https://api.unsplash.com';
  private readonly accessKey: string;

  constructor(private configService: ConfigService) {
    this.accessKey =
      this.configService.get<string>('UNSPLASH_ACCESS_KEY') || '';
  }

  async search(
    query: string,
    page: number = 1,
    perPage: number = 20,
  ): Promise<UnsplashSearchResponse> {
    if (!this.accessKey) {
      this.logger.warn('Unsplash API key is not configured');
      return { total: 0, total_pages: 0, results: [] };
    }

    const params = new URLSearchParams({
      query,
      page: String(page),
      per_page: String(perPage),
    });

    const response = await fetch(`${this.apiUrl}/search/photos?${params}`, {
      headers: {
        Authorization: `Client-ID ${this.accessKey}`,
      },
    });

    if (!response.ok) {
      this.logger.error(
        `Unsplash API error: ${response.status} ${response.statusText}`,
      );
      throw new Error(`Unsplash API error: ${response.statusText}`);
    }

    return response.json();
  }
}
