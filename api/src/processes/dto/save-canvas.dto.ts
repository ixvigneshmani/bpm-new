import { IsObject, IsNotEmpty } from "class-validator";

export class SaveCanvasDto {
  @IsObject()
  @IsNotEmpty()
  canvasData: Record<string, unknown>;
}
