import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type {
  AuthenticatedUser,
  RequestWithUser,
} from '../guards/jwt-auth.guard';

/**
 * Injects the acting user, derived from the verified JWT.
 *
 * THIS IS THE ONLY ACCEPTABLE SOURCE OF THE ACTING USER'S IDENTITY
 * (CLAUDE.md §2.3). Never read a userId from a request body, query string,
 * route param, or socket payload — all of those are attacker-controlled, and
 * in this codebase the acting identity decides who may see locked photos and
 * who may act as a circle admin.
 *
 *   @Get('me')
 *   getMe(@CurrentUser() user: AuthenticatedUser) { ... }
 *
 *   @Get('me')
 *   getMe(@CurrentUser('userId') userId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (
    field: keyof AuthenticatedUser | undefined,
    context: ExecutionContext,
  ): AuthenticatedUser | string => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      // Reaching here means the route was not covered by JwtAuthGuard — a
      // wiring bug, not a client error. Fail as a 500 rather than returning
      // undefined, which would surface much later as a confusing null-user
      // bug somewhere in a service.
      throw new InternalServerErrorException(
        'CurrentUser used on a route without JwtAuthGuard',
      );
    }

    return field ? user[field] : user;
  },
);
