import { IsOptional, IsInt, Min, Max, IsISO8601 } from "class-validator";
import { Type } from "class-transformer";

/** Query params for GET /ai/interactions.
 *  Keyset pagination: pass the previous page's last `createdAt` as
 *  `before` to fetch the next-older slice. Simpler than offset and
 *  stable under inserts. */
export class ListInteractionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsISO8601()
  before?: string;
}
