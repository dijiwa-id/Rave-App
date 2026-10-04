import type { RouteObject } from 'react-router-dom';
import { Todo } from './lazy';

// Rute Artist Studio (/studio), Promotor Hub (/promotor), Back Office (/admin).
export const b2bRoutes: RouteObject[] = [
  { path: '/studio/*', element: <Todo title="Artist Studio" /> },
  { path: '/promotor/*', element: <Todo title="Promotor Hub" /> },
  { path: '/admin/*', element: <Todo title="Back Office" /> },
];
