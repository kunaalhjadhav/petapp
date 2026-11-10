import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_BODY } from './chat.rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListConversationsQuery {
  /** Which inbox: the customer app's, the partner app's or the seller app's. */
  @ApiProperty({ enum: ['customer', 'partner', 'seller'] }) @IsIn(['customer', 'partner', 'seller']) as: 'customer' | 'partner' | 'seller';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}

/**
 * Start (or reopen) a conversation. Give exactly one:
 * - partnerId: a customer asking a service partner
 * - productId: a customer asking a seller about a product
 * - bookingId: either side of a booking
 * - subOrderId: either side of an order (one seller's parcel)
 */
export class StartConversationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() partnerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() bookingId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subOrderId?: string;
}

export class MessagesQuery {
  /** Older messages than this cursor (scrolling up). */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) before?: string;
  /** Newer messages than this cursor, oldest first (catching up after reconnecting). */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) after?: string;
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;
}

export class SendMessageDto {
  /** The app's own id for this message; a retried send with the same id is stored once. */
  @ApiPropertyOptional({ example: 'a1b2c3d4' }) @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{6,64}$/) clientId?: string;
  @ApiPropertyOptional({ maxLength: MAX_BODY }) @IsOptional() @Transform(trim) @IsString() @MaxLength(MAX_BODY) body?: string;
  /** A photo uploaded with `private: true` (or, in support, a PDF). */
  @ApiPropertyOptional() @IsOptional() @IsUUID() mediaId?: string;
  @ApiPropertyOptional({ enum: ['BOOKING', 'PRODUCT', 'ORDER'] }) @IsOptional() @IsIn(['BOOKING', 'PRODUCT', 'ORDER']) refType?: 'BOOKING' | 'PRODUCT' | 'ORDER';
  @ApiPropertyOptional() @IsOptional() @IsUUID() refId?: string;
}

// ───────────── support ─────────────

export class FaqQuery {
  @ApiProperty({ enum: ['customer', 'partner', 'seller'] }) @IsIn(['customer', 'partner', 'seller']) app: 'customer' | 'partner' | 'seller';
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
}

export class AppQuery {
  @ApiProperty({ enum: ['customer', 'partner', 'seller'] }) @IsIn(['customer', 'partner', 'seller']) app: 'customer' | 'partner' | 'seller';
}

export class OptionalAppQuery {
  @ApiPropertyOptional({ enum: ['customer', 'partner', 'seller'] }) @IsOptional() @IsIn(['customer', 'partner', 'seller']) app?: 'customer' | 'partner' | 'seller';
}

export class FaqFeedbackDto {
  @ApiProperty() @IsBoolean() helpful: boolean;
}

export class CreateTicketDto {
  @ApiProperty({ enum: ['customer', 'partner', 'seller'] }) @IsIn(['customer', 'partner', 'seller']) app: 'customer' | 'partner' | 'seller';
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty({ minLength: 3, maxLength: 120 }) @Transform(trim) @IsString() @MinLength(3) @MaxLength(120) subject: string;
  @ApiProperty({ minLength: 1, maxLength: MAX_BODY }) @Transform(trim) @IsString() @MinLength(1) @MaxLength(MAX_BODY) body: string;
  /** Up to 5 photos (uploaded with `private: true`) or PDFs. */
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsUUID('4', { each: true }) mediaIds?: string[];
  @ApiPropertyOptional({ enum: ['BOOKING', 'ORDER'] }) @IsOptional() @IsIn(['BOOKING', 'ORDER']) refType?: 'BOOKING' | 'ORDER';
  @ApiPropertyOptional() @IsOptional() @IsUUID() refId?: string;
}

export class AdminTicketsQuery {
  @ApiPropertyOptional({ enum: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED', 'active'] })
  @IsOptional() @IsIn(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED', 'active']) status?: string;
  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] }) @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  /** "me", "none", or a staff member's id. */
  @ApiPropertyOptional() @IsOptional() @Matches(/^(me|none|[0-9a-f-]{36})$/) assignee?: string;
  /** Ticket code, subject, or the person's name, phone or email. */
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 25 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  get skip() {
    return (this.page - 1) * this.limit;
  }
}

export class StaffReplyDto {
  @ApiProperty({ minLength: 1, maxLength: MAX_BODY }) @Transform(trim) @IsString() @MinLength(1) @MaxLength(MAX_BODY) body: string;
  /** A note for other staff only; the person never sees it. */
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() internal?: boolean;
  /** Set the status in the same step ("Reply and mark waiting"). */
  @ApiPropertyOptional({ enum: ['IN_PROGRESS', 'WAITING', 'RESOLVED'] }) @IsOptional() @IsIn(['IN_PROGRESS', 'WAITING', 'RESOLVED']) status?: 'IN_PROGRESS' | 'WAITING' | 'RESOLVED';
}

export class UpdateTicketDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'] })
  @IsOptional() @IsIn(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED']) status?: 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED';
  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] }) @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  /** A staff member's id, or null to unassign. */
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() assigneeId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
}

export class StaffStartTicketDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty({ minLength: 3, maxLength: 120 }) @Transform(trim) @IsString() @MinLength(3) @MaxLength(120) subject: string;
  @ApiProperty({ minLength: 1, maxLength: MAX_BODY }) @Transform(trim) @IsString() @MinLength(1) @MaxLength(MAX_BODY) body: string;
}

export class FaqDto {
  @ApiProperty({ minLength: 5, maxLength: 200 }) @Transform(trim) @IsString() @MinLength(5) @MaxLength(200) question: string;
  @ApiProperty({ minLength: 5, maxLength: 10_000 }) @IsString() @MinLength(5) @MaxLength(10_000) answer: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() categoryId?: string | null;
  @ApiPropertyOptional({ enum: ['ALL', 'CUSTOMER', 'PARTNER', 'SELLER'] }) @IsOptional() @IsIn(['ALL', 'CUSTOMER', 'PARTNER', 'SELLER']) audience?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() published?: boolean;
}

export class UpdateFaqDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(5) @MaxLength(200) question?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(5) @MaxLength(10_000) answer?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() categoryId?: string | null;
  @ApiPropertyOptional({ enum: ['ALL', 'CUSTOMER', 'PARTNER', 'SELLER'] }) @IsOptional() @IsIn(['ALL', 'CUSTOMER', 'PARTNER', 'SELLER']) audience?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() published?: boolean;
}

export class CategoryDto {
  @ApiProperty({ example: 'payments' }) @IsString() @Matches(/^[a-z][a-z0-9-]{1,39}$/) key: string;
  @ApiProperty({ maxLength: 60 }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(60) name: string;
  @ApiPropertyOptional({ enum: ['ALL', 'CUSTOMER', 'PARTNER', 'SELLER'] }) @IsOptional() @IsIn(['ALL', 'CUSTOMER', 'PARTNER', 'SELLER']) audience?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ maxLength: 60 }) @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @ApiPropertyOptional({ enum: ['ALL', 'CUSTOMER', 'PARTNER', 'SELLER'] }) @IsOptional() @IsIn(['ALL', 'CUSTOMER', 'PARTNER', 'SELLER']) audience?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
