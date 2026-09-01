import { prisma } from "../lib/prisma";

export async function getPermissionNamesForUser(userId: string): Promise<Set<string>> {
  const assignments = await prisma.userRole.findMany({
    where: { userId },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } }
        }
      }
    }
  });

  const names = new Set<string>();
  for (const assignment of assignments) {
    for (const rp of assignment.role.permissions) {
      names.add(rp.permission.name);
    }
  }
  return names;
}

async function ensureBaseRole(name: string, description: string, permissions: string[]): Promise<string> {
  const role = await prisma.role.upsert({
    where: { name },
    update: { description },
    create: { name, description }
  });

  for (const permissionName of permissions) {
    const permission = await prisma.permission.upsert({
      where: { name: permissionName },
      update: {},
      create: { name: permissionName }
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id }
    });
  }

  return role.id;
}

export async function seedBaseRoles(): Promise<void> {
  const userRoleId = await ensureBaseRole("user", "Default platform user", ["payments:create", "payments:read"]);
  await ensureBaseRole("admin", "Platform administrator", [
    "*",
    "users:read",
    "users:update",
    "audit:read",
    "roles:manage",
    "payments:read",
    "payments:refund"
  ]);

  const totalUsers = await prisma.user.count();
  if (totalUsers === 0) return;

  const anyUserRoles = await prisma.userRole.count({ where: { roleId: userRoleId } });
  if (anyUserRoles > 0) return;

  const firstUser = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (firstUser) {
    await prisma.userRole.create({
      data: { userId: firstUser.id, roleId: userRoleId }
    }).catch(() => undefined);
  }
}

export async function assignRoleToUser(userId: string, roleName: string): Promise<void> {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) return;
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: {},
    create: { userId, roleId: role.id }
  });
}
