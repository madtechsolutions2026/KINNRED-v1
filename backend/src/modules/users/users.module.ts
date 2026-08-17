import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { MediaModule } from '../media/media.module';

/**
 * Myspace.
 *
 * Imports MediaModule for photo rendering. VisibilityService arrives via the
 * global VisibilityModule — deliberately global so no module is ever tempted
 * to hand-roll the photo-lock rule because importing it felt like friction.
 */
@Module({
  imports: [MediaModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
