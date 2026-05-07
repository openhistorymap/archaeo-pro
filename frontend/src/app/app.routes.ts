import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/surveillances-list/surveillances-list').then((m) => m.SurveillancesList),
  },
  {
    path: 'new',
    loadComponent: () =>
      import('./features/surveillances-list/surveillances-list').then((m) => m.SurveillancesList),
    // TODO: real "new surveillance" form lands in next iteration.
  },
  {
    path: 'surveillances/:id',
    loadComponent: () =>
      import('./features/surveillances-list/surveillances-list').then((m) => m.SurveillancesList),
    // TODO: detail/edit view lands in next iteration.
  },
];
