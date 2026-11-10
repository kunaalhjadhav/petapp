import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';
import { AdminUsersController, UsersController } from './users.controller';

@Module({ imports: [AuthModule], controllers: [UsersController, AdminUsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
