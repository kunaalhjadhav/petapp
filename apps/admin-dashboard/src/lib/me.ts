import 'server-only';
import { cache } from 'react';
import type { PermissionKey } from '@petapp/types';
import { api } from './api';
import type { Me } from './types';

/** The signed-in staff member, fetched once per request. */
export const getMe = cache(() => api<Me>('/admin/auth/me'));

export function can(me: Me, permission: PermissionKey): boolean {
  return me.permissions.includes('*') || me.permissions.includes(permission);
}
