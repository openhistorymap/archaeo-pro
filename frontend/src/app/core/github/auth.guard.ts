import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { GitHubAuthService } from './auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(GitHubAuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/login'], { queryParams: { return_to: state.url } });
};
