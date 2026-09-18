import { createApp } from "./app.js";
import { readConfig } from "./config.js";

const config = readConfig();
// Configuration errors are safe to display; transport errors may contain secrets.
try {
  const app = await createApp(config);
  const server = app.listen(config.port, () => {
    console.log(`open-meteo-weather listening on :${config.port} (${config.chain.network}, $${config.price})`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
} catch {
  console.error("Service initialization failed; check facilitator connectivity and network support");
  process.exitCode = 1;
}
