import { IsUUID } from "class-validator";

export class ReassignTaskDto {
  @IsUUID()
  userId!: string;
}
