import type { PrismaClient } from '../../generated/prisma/client';
import { PERMISSION_CATALOG, ROLE_CATALOG } from './rbac.catalog';

/**
 * Idempotent. Creates missing permissions and system roles.
 * Default grants are applied (a) to a role created in this run, and (b) for a permission
 * created in this run, to every system role whose defaults include it — so upgrading to a
 * new phase gives existing roles that phase's permissions without overwriting edits made
 * in the dashboard. SUPER_ADMIN always receives every permission.
 */
export async function syncRbac(prisma: PrismaClient): Promise<void> {
  const knownPerms = new Set((await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key));
  const createdPerms = new Set<string>();
  for (const p of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, description: p.description },
      create: p,
    });
    if (!knownPerms.has(p.key)) createdPerms.add(p.key);
  }
  const perms = await prisma.permission.findMany({ select: { id: true, key: true } });
  const idOf = new Map(perms.map((p) => [p.key, p.id]));

  for (const r of ROLE_CATALOG) {
    const existing = await prisma.role.findUnique({ where: { key: r.key } });
    const role =
      existing ??
      (await prisma.role.create({
        data: { key: r.key, name: r.name, description: r.description, isStaff: r.isStaff, isSystem: true },
      }));
    const grant = !existing || r.key === 'SUPER_ADMIN' ? r.permissions : r.permissions.filter((k) => createdPerms.has(k));
    if (grant.length) {
      await prisma.rolePermission.createMany({
        data: grant.map((k) => ({ roleId: role.id, permissionId: idOf.get(k)! })),
        skipDuplicates: true,
      });
    }
  }
}
