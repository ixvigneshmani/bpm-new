import { IsUUID } from "class-validator";

export class AdminResetPasswordDto {
  @IsUUID()
  userId!: string;
}
