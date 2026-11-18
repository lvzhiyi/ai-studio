import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ENGINE_STEPS, EngineStep } from './engine-port';
import { CharacterDto } from '../storyboard/storyboard.dto';

export class CreateRunDto {
  @IsString()
  @MinLength(10)
  @MaxLength(3000)
  story!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CharacterDto)
  characters?: CharacterDto[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  title?: string;

  /** 引擎分镜文件名，不含目录。不传则用 agent-draft。 */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^(?!.*\.\.)(?!\.)[\p{L}\p{N}_\-.]+$/u)
  file?: string;

  /** 缺省只保存分镜表。images / audio / cast / qa 才会向引擎提交步骤。 */
  @IsOptional()
  @IsIn([...ENGINE_STEPS])
  step?: EngineStep;
}
