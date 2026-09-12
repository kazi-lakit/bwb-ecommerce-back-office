/**
 * Verifies `src/lib/blocks/orders.ts` — the Orders admin actions that move real stock
 * (fulfil consumes reserved inventory, cancel gives it back) — against a simulated Data
 * Gateway. Same approach and reasoning as the storefront's `verify:inventory`: this app has
 * no test runner, adding one is the repo owner's call, and these actions cannot be exercised
 * against the real gateway because neither the Order schema nor the inventory write policies
 * are live yet.
 *
 * The real modules are loaded through Vite's SSR pipeline, not copied, so they cannot drift
 * from what ships. Only the two gateway imports are swapped for fakes.
 *
 *     npm run verify:orders
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

const server = await createServer({
  root,
  configFile: false,
  logLevel: "warn",
  server: { middlewareMode: true, hmr: false },
  define: {
    "import.meta.env.VITE_INVENTORY_WRITES_LIVE": '"true"',
    "import.meta.env.VITE_COMMERCE_SCHEMAS_LIVE": '"true"',
  },
  resolve: {
    alias: [
      { find: "@", replacement: resolve(root, "src") },
      // Relative specifiers, so these only bite inside the blocks/ modules this graph loads.
      { find: /^\.\/client$/, replacement: resolve(here, "fake-client.ts") },
      { find: /^\.\/http$/, replacement: resolve(here, "fake-http.ts") },
    ],
  },
});

try {
  const orders = await server.ssrLoadModule(resolve(here, "scenarios.ts"));
  const failures = await orders.run();
  await server.close();
  process.exit(failures === 0 ? 0 : 1);
} catch (error) {
  await server.close();
  console.error(error);
  process.exit(1);
}
