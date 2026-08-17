import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as reachable without authentication.
 *
 * JwtAuthGuard is registered GLOBALLY, so every route is protected unless it
 * opts out with this decorator. That direction is deliberate: forgetting to
 * add a guard silently exposes an endpoint, whereas forgetting to add
 * @Public() produces a loud 401 in development. The failure mode we can afford
 * is the noisy one.
 *
 * Every use of this decorator is a deliberate hole in the auth surface. Keep
 * them countable, and justify each one.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
