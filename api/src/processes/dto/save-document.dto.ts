import { IsObject, IsNotEmpty, IsString, IsOptional, IsIn, IsUUID } from "class-validator";

export class SaveDocumentDto {
  @IsObject()
  @IsNotEmpty()
  schema: Record<string, unknown>;

  @IsString()
  @IsIn(["TEMPLATE", "PASTE", "EMPTY"])
  source: "TEMPLATE" | "PASTE" | "EMPTY";

  @IsUUID()
  @IsOptional()
  templateId?: string;
}
