import { InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseError, isSupabaseError } from '../types';

export function handleSupabaseError(
  logger: Logger,
  error: SupabaseError | unknown,
  context: string,
): never {
  const message = isSupabaseError(error) ? error.message : 'Unknown error';
  const stack = isSupabaseError(error) ? error.stack : undefined;
  logger.error(`${context}: ${message}`, stack);
  throw new InternalServerErrorException(`${context} 처리 중 오류가 발생했습니다`);
}
