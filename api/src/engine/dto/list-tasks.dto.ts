import { IsOptional, IsUUID } from "class-validator";

export class ListTasksDto {
  /** Exact-assignee filter — pass `me` to get only tasks claimed by
   *  you, or a UUID for an admin "show me Alice's queue" view.
   *  Mutually exclusive with the implicit "mine" mode (no params). */
  @IsOptional()
  @IsUUID()
  assignedTo?: string;
}
