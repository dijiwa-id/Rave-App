import type { Dict } from '../id';
import type { Shape } from '@/lib/i18n';
import common from './common';
import publicNs from './public';
import company from './company';
import fan from './fan';
import live from './live';
import b2b from './b2b';
import admin from './admin';
import cms from './cms';

/** English dictionary — dimuat lazy saat bahasa Inggris dipilih. Bentuknya dipaksa sama dengan kamus ID. */
export const en: Shape<Dict> = { common, public: publicNs, company, fan, live, b2b, admin, cms };
