/**
 * Local test-run config (NO Devvit). `npm run dev` serves the React/Phaser
 * client from src/client AND mounts the framework-agnostic server handlers
 * (src/server/index.ts) as in-process /api/* middleware backed by FakeRedis +
 * the offline MockProvider. This is the local playable harness; the real Devvit
 * deploy uses devvit.json + the @devvit/web adapter instead.
 */
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(repoRoot, "src/server/index.ts");

/** Map relative `*.js` import specifiers in OUR source to their `.ts`/`.tsx`
 *  file — only when the `.js` doesn't actually exist (never touches the dep
 *  optimizer's real `.js` chunks in node_modules/.vite). */
function jsToTs(): Plugin {
  return {
    name: "parlor-js-to-ts",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!/^\.\.?\//.test(source) || !source.endsWith(".js")) return null;
      if (importer && importer.includes("node_modules")) return null;
      // If the literal .js resolves (a real file), leave it for Vite.
      const asIs = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (asIs) return null;
      for (const ext of [".ts", ".tsx"]) {
        const r = await this.resolve(source.slice(0, -3) + ext, importer, { ...options, skipSelf: true });
        if (r) return r;
      }
      return null;
    },
  };
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((res, rej) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        res(data ? JSON.parse(data) : {});
      } catch (e) {
        rej(e);
      }
    });
    req.on("error", rej);
  });
}

/** In-process /api/* backed by the verified server handlers + FakeRedis/Mock. */
function localApi(): Plugin {
  return {
    name: "parlor-local-api",
    configureServer(server) {
      let handlers: Promise<Record<string, (...a: never[]) => Promise<unknown>>> | null = null;
      const getHandlers = () => {
        if (!handlers) {
          handlers = (async () => {
            const mod = (await server.ssrLoadModule(serverEntry)) as {
              createHandlers: (d: unknown) => Record<string, (...a: never[]) => Promise<unknown>>;
              defaultDeps: () => unknown;
            };
            return mod.createHandlers(mod.defaultDeps()); // single FakeRedis for the session
          })();
        }
        return handlers;
      };

      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "POST" || !req.url?.startsWith("/api/")) return next();
        const name = req.url.slice("/api/".length).split("?")[0]!;
        const playerId = "local-dev";
        const today = new Date().toISOString().slice(0, 10);
        try {
          const body = (await readJson(req)) as never;
          const h = await getHandlers();
          const call: Record<string, () => Promise<unknown>> = {
            startCase: () => h.startCase!(body, playerId as never),
            interrogate: () => h.interrogate!(body, playerId as never),
            examine: () => h.examine!(body, playerId as never),
            nominate: () => h.nominate!(body),
            accuse: () => h.accuse!(body, playerId as never, today as never),
          };
          if (!call[name]) {
            res.statusCode = 404;
            return res.end(`unknown endpoint: ${name}`);
          }
          const result = await call[name]!();
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(result));
        } catch (err) {
          server.config.logger.error(`[api/${name}] ${(err as Error)?.stack ?? err}`);
          res.statusCode = 500;
          res.end(String((err as Error)?.message ?? err));
        }
      });
    },
  };
}

export default defineConfig({
  root: resolve(repoRoot, "src/client"),
  plugins: [jsToTs(), react(), localApi()],
  server: { port: Number(process.env.PORT) || 3000, strictPort: false, host: true, fs: { allow: [repoRoot] } },
  preview: { port: Number(process.env.PORT) || 3000, host: true },
  build: { outDir: resolve(repoRoot, "dist/client"), emptyOutDir: true },
});
