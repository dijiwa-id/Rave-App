export {};
process.argv.push('web');
await import('./dev-services.js');
