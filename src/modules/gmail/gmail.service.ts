import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, gmail_v1 } from 'googleapis';

export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
}

export interface GmailThread {
  id: string;
  subject: string;
  from: string;
  lastMessageAt: string;
  messageCount: number;
  messages: GmailMessage[];
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);
  private gmail: gmail_v1.Gmail | null = null;
  private accountEmail: string | null = null;

  constructor(private configService: ConfigService) {
    this.initializeClient();
  }

  private initializeClient() {
    const clientId = this.configService.get<string>('GMAIL_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GMAIL_CLIENT_SECRET');
    const refreshToken = this.configService.get<string>('GMAIL_REFRESH_TOKEN');

    if (!clientId || !clientSecret || !refreshToken) {
      this.logger.warn('Gmail API 자격 증명이 설정되지 않았습니다');
      return;
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  }

  isConfigured(): boolean {
    return this.gmail !== null;
  }

  private ensureInitialized(): gmail_v1.Gmail {
    if (!this.gmail) {
      throw new BadRequestException(
        'Gmail API가 설정되지 않았습니다. 환경 변수(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)를 확인하세요.',
      );
    }
    return this.gmail;
  }

  async getAccountEmail(): Promise<string> {
    if (this.accountEmail) return this.accountEmail;

    const gmail = this.ensureInitialized();
    const profile = await gmail.users.getProfile({ userId: 'me' });
    this.accountEmail = profile.data.emailAddress || 'unknown';
    return this.accountEmail;
  }

  /**
   * 받은편지함의 스레드 수 조회 (labels.get 사용 — 정확한 값)
   * getProfile().messagesTotal은 전체 메일함(보낸편지함, 스팸, 휴지통 포함)의 개별 메시지 수를 반환하므로 부정확
   */
  async getInboxThreadCount(): Promise<number> {
    const gmail = this.ensureInitialized();
    const label = await gmail.users.labels.get({
      userId: 'me',
      id: 'INBOX',
    });
    return label.data.threadsTotal || 0;
  }

  /**
   * 이메일 스레드 목록 가져오기
   */
  async fetchThreads(params: {
    maxResults?: number;
    query?: string;
    pageToken?: string;
  }): Promise<{ threads: GmailThread[]; nextPageToken?: string }> {
    const gmail = this.ensureInitialized();
    const { maxResults = 50, query, pageToken } = params;

    const listResponse = await gmail.users.threads.list({
      userId: 'me',
      maxResults,
      q: query || 'in:inbox',
      pageToken,
    });

    const threadIds = (listResponse.data.threads || []).filter(
      (t): t is { id: string } => !!t.id,
    );
    const nextPageToken = listResponse.data.nextPageToken || undefined;

    // 30개씩 병렬로 스레드 상세 가져오기
    const CONCURRENCY = 30;
    const threads: GmailThread[] = [];

    for (let i = 0; i < threadIds.length; i += CONCURRENCY) {
      const chunk = threadIds.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((ref) => this.getThread(ref.id)),
      );
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          threads.push(result.value);
        }
      }
    }

    return { threads, nextPageToken };
  }

  /**
   * 단일 스레드 가져오기
   */
  async getThread(threadId: string): Promise<GmailThread | null> {
    const gmail = this.ensureInitialized();

    const threadResponse = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    });

    const gmailMessages = threadResponse.data.messages || [];
    if (gmailMessages.length === 0) return null;

    const messages: GmailMessage[] = gmailMessages.map((msg) =>
      this.parseMessage(msg),
    );

    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];

    return {
      id: threadId,
      subject: firstMessage.subject,
      from: firstMessage.from,
      lastMessageAt: lastMessage.date,
      messageCount: messages.length,
      messages,
    };
  }

  private parseMessage(msg: gmail_v1.Schema$Message): GmailMessage {
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string): string =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value || '';

    return {
      id: msg.id || '',
      threadId: msg.threadId || '',
      subject: getHeader('subject'),
      from: getHeader('from'),
      to: getHeader('to'),
      date: getHeader('date'),
      body: this.extractBody(msg.payload),
    };
  }

  private extractBody(payload?: gmail_v1.Schema$MessagePart): string {
    if (!payload) return '';

    // text/plain 직접 반환
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    // multipart인 경우 parts에서 text/plain 먼저 찾기
    if (payload.parts) {
      // text/plain 우선
      const textPart = payload.parts.find((p) => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      }

      // text/html 차선
      const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
      if (htmlPart?.body?.data) {
        const html = Buffer.from(htmlPart.body.data, 'base64').toString(
          'utf-8',
        );
        return this.stripHtml(html);
      }

      // 재귀 탐색
      for (const part of payload.parts) {
        const body = this.extractBody(part);
        if (body) return body;
      }
    }

    // body가 직접 있는 경우 - HTML일 수 있으므로 항상 stripHtml 처리
    if (payload.body?.data) {
      const raw = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      return raw.includes('<') ? this.stripHtml(raw) : raw;
    }

    return '';
  }

  private stripHtml(html: string): string {
    return (
      html
        // style/script 태그 전체 제거
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        // 줄바꿈이 되어야 하는 태그
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n')
        .replace(/<\/blockquote>/gi, '\n')
        .replace(/<hr\s*\/?>/gi, '\n---\n')
        // 나머지 태그 제거
        .replace(/<[^>]*>/g, '')
        // HTML 엔티티 디코딩
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
          String.fromCharCode(parseInt(hex, 16)),
        )
        // 공백/줄바꿈 정리
        .replace(/[ \t]+/g, ' ')
        .replace(/\n /g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    );
  }
}
