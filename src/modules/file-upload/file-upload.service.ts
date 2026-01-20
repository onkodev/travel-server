import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class FileUploadService {
  private readonly logger = new Logger(FileUploadService.name);
  private region: string;
  private accessKey: string;
  private secretKey: string;
  private bucket: string;

  constructor(private configService: ConfigService) {
    this.region = this.configService.get<string>('AWS_REGION') || 'ap-northeast-2';
    this.accessKey = this.configService.get<string>('AWS_ACCESS_KEY') || '';
    this.secretKey = this.configService.get<string>('AWS_SECRET_KEY') || '';
    this.bucket = this.configService.get<string>('AWS_BUCKET_NAME') || 'tumakr-prod';
  }

  // HMAC SHA256
  private hmacSha256(key: Buffer, message: string): Buffer {
    return crypto.createHmac('sha256', key).update(message).digest();
  }

  // SHA256 해시
  private sha256(message: Buffer): string {
    return crypto.createHash('sha256').update(message).digest('hex');
  }

  // AWS Signature Key 생성
  private getSignatureKey(dateStamp: string): Buffer {
    const kDate = this.hmacSha256(Buffer.from('AWS4' + this.secretKey), dateStamp);
    const kRegion = this.hmacSha256(kDate, this.region);
    const kService = this.hmacSha256(kRegion, 's3');
    return this.hmacSha256(kService, 'aws4_request');
  }

  // 파일 업로드
  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'items',
  ): Promise<{ success: boolean; url?: string; key?: string; error?: string }> {
    if (!this.accessKey || !this.secretKey) {
      return { success: false, error: 'AWS credentials not configured' };
    }

    try {
      const body = file.buffer;
      const ext = file.originalname.split('.').pop() || 'jpg';
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
      const key = `${folder}/${fileName}`;
      const contentType = file.mimetype || `image/${ext === 'jpg' ? 'jpeg' : ext}`;

      // AWS Signature V4
      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.slice(0, 8);

      const host = `${this.bucket}.s3.${this.region}.amazonaws.com`;
      const payloadHash = this.sha256(body);

      const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

      const canonicalRequest = `PUT\n/${key}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
      const canonicalRequestHash = this.sha256(Buffer.from(canonicalRequest));

      const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
      const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

      const signingKey = this.getSignatureKey(dateStamp);
      const signature = this.hmacSha256(signingKey, stringToSign).toString('hex');

      const authHeader = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      // S3 업로드
      const uploadResponse = await fetch(`https://${host}/${key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'x-amz-content-sha256': payloadHash,
          'x-amz-date': amzDate,
          Authorization: authHeader,
        },
        body: new Uint8Array(body),
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        this.logger.error(`S3 upload failed: ${uploadResponse.status} ${errorText}`);
        return { success: false, error: 'S3 upload failed' };
      }

      const url = `https://${host}/${key}`;
      return { success: true, url, key };
    } catch (error) {
      this.logger.error('Upload error:', error);
      return { success: false, error: 'Upload failed' };
    }
  }

  // URL에서 이미지 다운로드 후 S3 업로드
  async uploadFromUrl(
    imageUrl: string,
    contentId: string,
    folder: string = 'items',
  ): Promise<string | null> {
    if (!this.accessKey || !this.secretKey) {
      this.logger.warn('AWS credentials not configured');
      return null;
    }

    this.logger.debug(`Uploading from URL: ${imageUrl}`);

    try {
      // 이미지 다운로드
      const response = await fetch(imageUrl);
      if (!response.ok) {
        this.logger.error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const body = Buffer.from(arrayBuffer);

      // 확장자 추출
      const ext = imageUrl.split('.').pop()?.split('?')[0] || 'jpg';
      const fileName = `tour-api-${contentId}-${Date.now()}.${ext}`;
      const key = `${folder}/${fileName}`;
      const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

      // AWS Signature V4
      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.slice(0, 8);

      const host = `${this.bucket}.s3.${this.region}.amazonaws.com`;
      const payloadHash = this.sha256(body);

      const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

      const canonicalRequest = `PUT\n/${key}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
      const canonicalRequestHash = this.sha256(Buffer.from(canonicalRequest));

      const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
      const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

      const signingKey = this.getSignatureKey(dateStamp);
      const signature = this.hmacSha256(signingKey, stringToSign).toString('hex');

      const authHeader = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      // S3 업로드
      const uploadResponse = await fetch(`https://${host}/${key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'x-amz-content-sha256': payloadHash,
          'x-amz-date': amzDate,
          Authorization: authHeader,
        },
        body: new Uint8Array(body),
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        this.logger.error(`Upload failed: ${uploadResponse.status} ${errorText}`);
        return null;
      }

      const s3Url = `https://${host}/${key}`;
      this.logger.debug(`Upload success: ${s3Url}`);
      return s3Url;
    } catch (error) {
      this.logger.error('Upload error:', error);
      return null;
    }
  }
}
