export interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest {
  user: JwtPayload;
}
