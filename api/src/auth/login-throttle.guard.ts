import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";

const LOGIN_LIMIT_COUNT = 10;
const LOGIN_LIMIT_WINDOW_MS = 60 * 1000;

@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly buckets = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ ip?: string }>();
    const ip = req.ip || "unknown";
    const now = Date.now();
    const cutoff = now - LOGIN_LIMIT_WINDOW_MS;

    const bucket = (this.buckets.get(ip) ?? []).filter((t) => t > cutoff);

    if (bucket.length >= LOGIN_LIMIT_COUNT) {
      throw new HttpException(
        "Too many login attempts. Try again in a minute.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.push(now);
    this.buckets.set(ip, bucket);
    return true;
  }
}
