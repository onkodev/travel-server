import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '@prisma/client';

interface ErrorResponse {
  statusCode: number;
  message: string;
  error?: string;
  details?: string[];
  timestamp: string;
  path: string;
  [key: string]: unknown;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const errorResponse = this.buildErrorResponse(exception, request.url);

    // 500+ 에러만 로깅 (클라이언트 에러는 로깅 불필요)
    if (errorResponse.statusCode >= 500) {
      // DB 연결 에러는 간략하게 (스택 트레이스 생략)
      if (this.isDbConnectionError(exception)) {
        this.logger.warn(`${request.method} ${request.url} — DB 연결 실패 (일시적)`);
      } else {
        this.logger.error(
          `${request.method} ${request.url}`,
          exception instanceof Error ? exception.stack : String(exception),
        );
      }
    }

    response.status(errorResponse.statusCode).json(errorResponse);
  }

  private buildErrorResponse(exception: unknown, path: string): ErrorResponse {
    const timestamp = new Date().toISOString();

    // NestJS HttpException
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        return {
          statusCode: status,
          message: exceptionResponse,
          timestamp,
          path,
        };
      }

      const responseBody = exceptionResponse as Record<string, unknown>;
      const { message: _m, error: _e, statusCode: _s, ...extra } = responseBody;
      return {
        statusCode: status,
        message: this.extractMessage(responseBody),
        error: responseBody.error as string | undefined,
        details: this.extractDetails(responseBody),
        timestamp,
        path,
        ...extra,
      };
    }

    // Prisma DB 연결 에러 (일시적 장애)
    if (this.isDbConnectionError(exception)) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: '일시적으로 서비스를 이용할 수 없습니다',
        error: 'Service Unavailable',
        timestamp,
        path,
      };
    }

    // Prisma 에러 처리
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.handlePrismaError(exception, path, timestamp);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      // 디버깅용 로그
      this.logger.error(`Prisma Validation Error: ${exception.message}`);
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: '데이터 유효성 검사 실패',
        error: 'Validation Error',
        ...(process.env.NODE_ENV !== 'production' && {
          details: [exception.message],
        }),
        timestamp,
        path,
      };
    }

    // 알 수 없는 에러
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: '서버 내부 오류가 발생했습니다',
      error: 'Internal Server Error',
      timestamp,
      path,
    };
  }

  private handlePrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
    path: string,
    timestamp: string,
  ): ErrorResponse {
    switch (exception.code) {
      case 'P2002': // Unique constraint violation
        return {
          statusCode: HttpStatus.CONFLICT,
          message: '이미 존재하는 데이터입니다',
          error: 'Conflict',
          timestamp,
          path,
        };

      case 'P2025': // Record not found
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: '데이터를 찾을 수 없습니다',
          error: 'Not Found',
          timestamp,
          path,
        };

      case 'P2003': // Foreign key constraint violation
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: '참조하는 데이터가 존재하지 않습니다',
          error: 'Bad Request',
          timestamp,
          path,
        };

      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: '데이터베이스 오류가 발생했습니다',
          error: 'Database Error',
          timestamp,
          path,
        };
    }
  }

  private isDbConnectionError(exception: unknown): boolean {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // P1001: Can't reach database server, P1002: timeout
      return exception.code === 'P1001' || exception.code === 'P1002';
    }
    if (exception instanceof Error) {
      return exception.message.includes("Can't reach database server");
    }
    return false;
  }

  private extractMessage(response: Record<string, unknown>): string {
    const message = response.message;
    if (Array.isArray(message)) {
      return message[0] as string;
    }
    return (message as string) || '요청 처리 중 오류가 발생했습니다';
  }

  private extractDetails(
    response: Record<string, unknown>,
  ): string[] | undefined {
    const message = response.message;
    if (Array.isArray(message) && message.length > 1) {
      return message as string[];
    }
    return undefined;
  }
}
