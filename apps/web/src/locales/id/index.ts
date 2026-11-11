import common from './common';
import publicNs from './public';
import company from './company';
import fan from './fan';
import live from './live';
import b2b from './b2b';
import admin from './admin';
import cms from './cms';

/** Kamus Bahasa Indonesia (default, dibundel langsung). */
export const id = { common, public: publicNs, company, fan, live, b2b, admin, cms };
export type Dict = typeof id;
