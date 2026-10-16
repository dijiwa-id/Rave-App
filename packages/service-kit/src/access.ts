import type { FastifyRequest } from 'fastify';
import { ADMIN_PERMISSIONS, adminPermissions, type AdminPermission } from '@gema/domain/settings';
import type { AuthUser } from './auth.js';
import { forbidden, unauthorized } from './errors.js';
import { settings } from './settings.js';

/**
 * Izin back office (REQ-ADM-01): matriks peran → izin diatur Super Admin (`access.role.*`) dan dibaca dari
 * pengaturan terkini, jadi perubahan berlaku seketika tanpa login ulang. Peran admin dibawa token (`admin_role`);
 * token admin lama tanpa peran diperlakukan sebagai Operasional (sama seperti IAM).
 */
export function hasPermission(u: AuthUser | null | undefined, perm: AdminPermission): boolean {
  if (!u || !u.roles.includes('admin')) return false;
  return adminPermissions(u.admin_role ?? 'OPS', (k) => settings.get(k)).includes(perm);
}

/** preHandler: admin dengan izin `perm` (atau token service antar-service). */
export function requirePermission(perm: AdminPermission) {
  return async (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    if (req.user.roles.includes('service')) return;
    if (!hasPermission(req.user, perm)) throw forbidden(`Peran Anda tidak memiliki akses: ${ADMIN_PERMISSIONS[perm].label}`);
  };
}
