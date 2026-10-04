// Cetak access token dev untuk pengujian manual (curl).
// Pakai: npx tsx scripts/token.ts <userId> <roles,koma> ['<orgs json>']
import { signAccessToken } from '@gema/service-kit';

const [sub = '01900000-0000-7000-8000-000000000005', roles = 'admin', orgs = '[]'] = process.argv.slice(2);
console.log(await signAccessToken({ sub, roles: roles.split(',') as any, orgs: JSON.parse(orgs), kyc: true }, 3600));
