import { Controller, Post, Get, Patch, Body, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/user.decorator';
import {
  SignInDto,
  SignUpDto,
  UpdateProfileDto,
  UpdatePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  GoogleOAuthUrlDto,
  GoogleCallbackDto,
  RefreshTokenDto,
  ResendVerificationDto,
  AuthResponseDto,
  UserDto,
  GoogleOAuthUrlResponseDto,
  CheckEmailResponseDto,
  SuccessMessageResponseDto,
} from './dto';
import { ErrorResponseDto } from '../../common/dto';

@ApiTags('인증')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @SkipThrottle()
  @Post('signin')
  @ApiOperation({
    summary: '로그인',
    description: '이메일과 비밀번호로 로그인합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '로그인 성공',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  async signIn(@Body() body: SignInDto) {
    return this.authService.signIn(body.email, body.password);
  }

  @Public()
  @Post('signup')
  @ApiOperation({
    summary: '회원가입',
    description: '새로운 계정을 생성합니다. 이메일 인증이 필요할 수 있습니다.',
  })
  @ApiResponse({
    status: 201,
    description: '회원가입 성공',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: '이미 존재하는 이메일',
    type: ErrorResponseDto,
  })
  async signUp(@Body() body: SignUpDto) {
    return this.authService.signUp(body.email, body.password, body.name, body.redirectTo);
  }

  @Post('signout')
  @SkipThrottle()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '로그아웃',
    description: '현재 세션을 종료합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '로그아웃 성공',
    type: SuccessMessageResponseDto,
  })
  async signOut() {
    return { success: true };
  }

  @Get('me')
  @SkipThrottle()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '내 정보 조회',
    description: '현재 로그인한 사용자의 정보를 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공', type: UserDto })
  @ApiResponse({
    status: 401,
    description: '인증 필요',
    type: ErrorResponseDto,
  })
  async getMe(@CurrentUser() user: any) {
    return this.authService.getMe(user.id, user);
  }

  @Public()
  @SkipThrottle()
  @Post('refresh')
  @ApiOperation({
    summary: '토큰 갱신',
    description: '리프레시 토큰으로 새로운 액세스 토큰을 발급받습니다.',
  })
  @ApiResponse({ status: 200, description: '갱신 성공', type: AuthResponseDto })
  @ApiResponse({
    status: 401,
    description: '유효하지 않은 리프레시 토큰',
    type: ErrorResponseDto,
  })
  async refreshToken(@Body() body: RefreshTokenDto) {
    return this.authService.refreshToken(body.refreshToken);
  }

  @Public()
  @Get('check-email')
  @ApiOperation({
    summary: '이메일 중복 확인',
    description: '이메일이 이미 사용 중인지 확인합니다.',
  })
  @ApiQuery({
    name: 'email',
    description: '확인할 이메일 주소',
    example: 'user@example.com',
  })
  @ApiResponse({
    status: 200,
    description: '확인 완료',
    type: CheckEmailResponseDto,
  })
  async checkEmail(@Query('email') email: string) {
    return this.authService.checkEmail(email);
  }

  @Public()
  @Post('google')
  @ApiOperation({
    summary: 'Google OAuth URL 생성',
    description: 'Google 소셜 로그인을 위한 인증 URL을 생성합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'URL 생성 성공',
    type: GoogleOAuthUrlResponseDto,
  })
  async getGoogleOAuthUrl(@Body() body: GoogleOAuthUrlDto) {
    return this.authService.getGoogleOAuthUrl(body.redirectTo);
  }

  @Public()
  @Post('google/callback')
  @ApiOperation({
    summary: 'Google OAuth 콜백',
    description: 'Google 인증 후 콜백을 처리하고 사용자를 로그인시킵니다.',
  })
  @ApiResponse({
    status: 200,
    description: '로그인 성공',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '인증 실패',
    type: ErrorResponseDto,
  })
  async handleGoogleCallback(@Body() body: GoogleCallbackDto) {
    return this.authService.handleGoogleCallback(body.code);
  }

  @Public()
  @Post('forgot-password')
  @ApiOperation({
    summary: '비밀번호 재설정 요청',
    description: '비밀번호 재설정을 위한 이메일을 발송합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '이메일 발송 성공',
    type: SuccessMessageResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '존재하지 않는 이메일',
    type: ErrorResponseDto,
  })
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body.email, body.redirectTo);
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({
    summary: '비밀번호 재설정',
    description: '이메일로 받은 토큰을 사용하여 비밀번호를 재설정합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '재설정 성공',
    type: SuccessMessageResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '유효하지 않은 토큰',
    type: ErrorResponseDto,
  })
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.accessToken, body.password);
  }

  @Patch('profile')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '프로필 수정',
    description: '사용자의 이름, 전화번호 등 프로필 정보를 수정합니다.',
  })
  @ApiResponse({ status: 200, description: '수정 성공', type: UserDto })
  @ApiResponse({
    status: 401,
    description: '인증 필요',
    type: ErrorResponseDto,
  })
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() body: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(userId, body);
  }

  @Patch('password')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '비밀번호 변경',
    description: '로그인된 사용자의 비밀번호를 변경합니다. 현재 비밀번호 확인이 필요합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '변경 성공',
    type: SuccessMessageResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '현재 비밀번호 불일치',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '인증 필요',
    type: ErrorResponseDto,
  })
  async updatePassword(
    @CurrentUser('id') userId: string,
    @Body() body: UpdatePasswordDto,
  ) {
    return this.authService.updatePassword(userId, body.currentPassword, body.newPassword);
  }

  @Public()
  @Post('resend-verification')
  @ApiOperation({
    summary: '인증 이메일 재발송',
    description: '이메일 인증을 위한 메일을 다시 발송합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '발송 성공',
    type: SuccessMessageResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '존재하지 않는 이메일',
    type: ErrorResponseDto,
  })
  async resendVerificationEmail(@Body() body: ResendVerificationDto) {
    return this.authService.resendVerificationEmail(
      body.email,
      body.redirectTo,
    );
  }
}
