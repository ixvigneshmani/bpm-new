import { IsIn, IsString, MaxLength } from "class-validator";

export class GrantPermissionDto {
  @IsIn(["user", "role"])
  granteeType!: "user" | "role";

  @IsString()
  @MaxLength(128)
  granteeId!: string;

  @IsIn(["view", "start", "edit", "publish", "admin"])
  permission!: "view" | "start" | "edit" | "publish" | "admin";
}
