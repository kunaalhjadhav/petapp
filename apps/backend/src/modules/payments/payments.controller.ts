import { Body, Controller, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, Public } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { PaymentsService } from './payments.service';

class VerifyCheckoutDto {
  @ApiProperty({ description: 'razorpay_payment_id from the checkout callback' }) @IsString() @Length(4, 100) providerPaymentId: string;
  @ApiProperty({ description: 'razorpay_signature from the checkout callback' }) @IsString() @Length(16, 200) signature: string;
}

@ApiTags('Payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @ApiBearerAuth()
  @Post('payments/:id/verify')
  @HttpCode(200)
  verify(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyCheckoutDto) {
    return this.payments.verifyCheckout(me.userId, id, dto.providerPaymentId, dto.signature);
  }

  /** Development only (fake provider): completes the checkout. 404 with a real gateway. */
  @ApiBearerAuth()
  @Post('payments/:id/simulate')
  @HttpCode(200)
  simulate(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.simulate(me.userId, id);
  }

  /** Configure this URL in the Razorpay dashboard (events: payment.captured, payment.failed, order.paid, refund.processed, refund.failed). */
  @Public()
  @Post('webhooks/payments')
  @HttpCode(200)
  webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>) {
    return this.payments.handleWebhook(req.rawBody, headers);
  }
}
