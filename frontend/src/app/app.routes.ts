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
      import('./features/surveillance-new/surveillance-new').then((m) => m.SurveillanceNew),
  },
  {
    path: 'surveillances/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/surveillance-detail/surveillance-detail').then((m) => m.SurveillanceDetail),
  },
  {
    path: 'surveillances/:id/map',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/surveillance-map/surveillance-map').then((m) => m.SurveillanceMap),
  },
];
