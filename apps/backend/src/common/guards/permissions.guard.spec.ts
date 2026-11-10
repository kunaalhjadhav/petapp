import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import type { Principal } from '../principal';

function ctx(principal?: Partial<Principal>): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const reflector = new Reflector();
  const guard = new PermissionsGuard(reflector);
  const need = (p: string[]) => jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(p);

  afterEach(() => jest.restoreAllMocks());

  it('allows routes without requirements', () => {
    need([]);
    expect(guard.canActivate(ctx())).toBe(true);
  });
  it('allows when all permissions are held', () => {
    need(['users.read', 'users.suspend']);
    expect(guard.canActivate(ctx({ permissions: ['users.read', 'users.suspend'], isSuperAdmin: false }))).toBe(true);
  });
  it('denies when any permission is missing', () => {
    need(['users.read', 'users.suspend']);
    expect(() => guard.canActivate(ctx({ permissions: ['users.read'], isSuperAdmin: false }))).toThrow(ForbiddenException);
  });
  it('super admin bypasses', () => {
    need(['roles.manage']);
    expect(guard.canActivate(ctx({ permissions: [], isSuperAdmin: true }))).toBe(true);
  });
  it('denies without a principal', () => {
    need(['users.read']);
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });
});
