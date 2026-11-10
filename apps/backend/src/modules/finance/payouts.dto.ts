import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AddPayoutAccountDto {
  @ApiProperty({ enum: ['BANK', 'UPI'] }) @IsIn(['BANK', 'UPI']) method: 'BANK' | 'UPI';
  @ApiProperty({ example: 'Meera Sharma', description: 'As the bank has it' }) @Transform(trim) @IsString() @Length(2, 100) holderName: string;
  @ApiPropertyOptional({ example: 'HDFC0001234' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(11) ifsc?: string;
  @ApiPropertyOptional({ example: '50100123456789', description: 'Stored encrypted; only the last 4 digits are ever shown' }) @IsOptional() @IsString() @MaxLength(20) accountNumber?: string;
  @ApiPropertyOptional({ example: 'meera@okhdfcbank' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(300) vpa?: string;
}

export class PayeeTypeQuery {
  @ApiPropertyOptional({ enum: ['VENDOR', 'PARTNER', 'USER'] }) @IsOptional() @IsIn(['VENDOR', 'PARTNER', 'USER']) payeeType?: 'VENDOR' | 'PARTNER' | 'USER';
}

export class CreateBatchDto extends PayeeTypeQuery {
  @ApiPropertyOptional({ example: 'Weekly payout' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(200) note?: string;
}

export class BatchesQuery extends PaginationQuery {}

export class PayoutAccountsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['PENDING', 'VERIFIED', 'FAILED', 'DISABLED'] }) @IsOptional() @IsIn(['PENDING', 'VERIFIED', 'FAILED', 'DISABLED']) status?: 'PENDING' | 'VERIFIED' | 'FAILED' | 'DISABLED';
  @ApiPropertyOptional({ enum: ['VENDOR', 'PARTNER', 'USER'] }) @IsOptional() @IsIn(['VENDOR', 'PARTNER', 'USER']) ownerType?: string;
}

export class DisableAccountDto {
  @ApiProperty({ example: 'Reported as not belonging to the seller' }) @Transform(trim) @IsString() @Length(3, 300) reason: string;
}

export class PrizesQuery {
  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'PAID'], default: 'PENDING' }) @IsOptional() @IsIn(['PENDING', 'APPROVED', 'PAID']) status?: 'PENDING' | 'APPROVED' | 'PAID';
}
