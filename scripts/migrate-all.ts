export {};
process.argv[2] = 'migrate';
await import('./seed-all.js');
