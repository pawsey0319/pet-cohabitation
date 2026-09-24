// Vercel puts the OS hostname in an HTTP header. Encode only that process-local
// value when a Windows hostname contains Chinese characters; keep TLS intact.
const os = require('node:os');
const hostname = os.hostname();
os.hostname = () => hostname.replace(/[^\x20-\x7e]/g, '-');
const cli = process.argv[2];
if (!cli) throw new Error('Provide the installed Vercel CLI entry path');
process.argv = [process.execPath, cli, ...process.argv.slice(3)];
require(cli);
