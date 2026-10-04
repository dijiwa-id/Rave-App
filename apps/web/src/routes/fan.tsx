import type { RouteObject } from 'react-router-dom';
import { FanLayout } from '@/layouts/FanLayout';
import { Todo } from './lazy';

// Rute publik (landing, login, onboarding, premium) + aplikasi fan (/app/*).
export const publicRoutes: RouteObject[] = [
  { path: '/', element: <Todo title="Landing" /> },
  { path: '/login', element: <Todo title="Masuk" /> },
];

export const fanRoutes: RouteObject = {
  path: '/app',
  element: <FanLayout />,
  children: [{ index: true, element: <Todo title="Beranda" /> }],
};
