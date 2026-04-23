export interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  displayName: string;
  /** Platform access level (owner/admin/member/viewer). Gates admin
   *  features like Roles mutations, OS1/OS2 panels. */
  systemRole: string;
  /** Domain roles (keys), e.g. ["manager"]. Drives task routing and
   *  claim authorization in the engine. */
  roles: string[];
  iat?: number;
  exp?: number;
}

/** Resolved impersonation target, set by `resolveActingFor` when the
 *  caller (an admin) passes `X-Acting-For: <userId>`. Business logic
 *  operates on `actingFor.userId` as the effective actor; audit rows
 *  carry BOTH ids so compliance can see who really did what.
 *  Non-admins get 403 if they try to set the header at all. */
export interface ActingFor {
  userId: string;
  email: string;
  displayName: string;
  roles: string[];
}

export interface AuthenticatedRequest {
  user: JwtPayload;
  actingFor?: ActingFor;
}
