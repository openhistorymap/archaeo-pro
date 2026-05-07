import { Routes } from '@angular/router';

import { authGuard } from './core/github/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    path: 'auth/callback',
    loadComponent: () => import('./features/auth-callback/auth-callback').then((m) => m.AuthCallback),
  },
  {
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/surveillances-list/surveillances-list').then((m) => m.SurveillancesList),
  },
  {
    path: 'new',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/surveillances-list/surveillances-list').then((m) => m.SurveillancesList),
    // TODO(commit 3): real "new surveillance" form.
  },
  {
    path: 'surveillances/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/surveillances-list/surveillances-list').then((m) => m.SurveillancesList),
    // TODO(commit 3): detail/edit view.
  },
];
