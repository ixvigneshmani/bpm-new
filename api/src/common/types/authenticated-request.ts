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

export interface AuthenticatedRequest {
  user: JwtPayload;
}
