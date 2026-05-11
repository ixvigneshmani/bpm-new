import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException("Missing authentication token");
    }

    try {
      const payload = await this.jwt.verifyAsync(token);
      // Reject MFA challenge tokens — they're issued by /auth/login when
      // MFA is required and only valid as input to /auth/mfa/login. They
      // are NOT access tokens; allowing them through would let an
      // attacker who grabs a challenge bypass MFA on any protected
      // endpoint (the payload lacks roles/tenantId, but the access bit
      // would be granted).
      if (payload?.mfaPending) {
        throw new UnauthorizedException("Token is an MFA challenge, not an access token");
      }
      (request as any).user = payload;
      return true;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException("Invalid or expired token");
    }
  }

  private extractToken(request: any): string | null {
    const auth = request.headers.authorization;
    if (!auth) return null;
    const [type, token] = auth.split(" ");
    return type === "Bearer" ? token : null;
  }
}
