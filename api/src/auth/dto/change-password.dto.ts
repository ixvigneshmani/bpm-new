import { IsNotEmpty, IsString, Matches, MinLength } from "class-validator";

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters." })
  @Matches(/[a-zA-Z]/, { message: "Password must contain a letter." })
  @Matches(/[0-9]/, { message: "Password must contain a digit." })
  newPassword!: string;
}
