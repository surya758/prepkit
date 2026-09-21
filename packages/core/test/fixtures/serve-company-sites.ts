import { startCompanySites } from "./company-sites";

// npm run fixtures — serves the three fake company sites the tests use, on the port the
// brief's own example uses, so `npm run evaluate` can be tried without touching the internet.
const port = Number(process.env.PORT ?? 8099);
const sites = await startCompanySites(port);
console.log(`Fixture company sites on ${sites.origin.replace("127.0.0.1", "localhost")}/{acme,globex,initech}/  (Ctrl+C to stop)`);
