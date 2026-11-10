import { Global, Module } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { RolesController } from './roles.controller';

@Global()
@Module({ providers: [RbacService], controllers: [RolesController], exports: [RbacService] })
export class RbacModule {}
