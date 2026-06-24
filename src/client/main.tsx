/**
 * src/client/main.tsx — React root entry. Mounts <App/> and supplies a
 * PhaserBridge.
 *
 * App depends only on the bridge INTERFACE (src/client/bridge.ts), never on the
 * Phaser implementation. The concrete bridge (Phaser scenes) is owned by the
 * phaser/ workstream and resolved at runtime; until it exists we fall back to a
 * typed no-op bridge so the React shell renders and stays decoupled.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type {
  PhaserBridge,
  WorldHandle,
  WorldHandlers,
  BoardHandle,
  BoardHandlers,
  BoardData,
} from "./bridge.js";
import type { ClientCaseView } from "../shared/api.js";
import { App } from "./App.js";

/** Typed no-op bridge: renders the React shell without the Phaser canvases. */
const noopBridge: PhaserBridge = {
  mountWorld(_el: HTMLElement, _view: ClientCaseView, _handlers: WorldHandlers): WorldHandle {
    return { setActiveZone() {}, destroy() {} };
  },
  mountBoard(_el: HTMLElement, _data: BoardData, _handlers: BoardHandlers): BoardHandle {
    return { addCard() {}, setStrength() {}, destroy() {} };
  },
};

async function resolveBridge(): Promise<PhaserBridge> {
  try {
    // The phaser/ workstream exports a concrete bridge as `bridge`. A literal
    // specifier lets Vite resolve + serve the Phaser implementation (a computed
    // specifier would silently fall back to the no-op bridge below).
    const mod = (await import("./phaser/index.js")) as { bridge?: PhaserBridge };
    return mod.bridge ?? noopBridge;
  } catch {
    return noopBridge;
  }
}

function getDailySeed(): string {
  // Host may inject the seed on <body data-daily-seed>; else default to today (UTC).
  const fromDom = document.body?.dataset?.dailySeed;
  return fromDom && fromDom.length > 0 ? fromDom : new Date().toISOString().slice(0, 10);
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Parlor: #root not found");
const root = createRoot(rootEl);

void resolveBridge().then((bridge) => {
  root.render(
    <StrictMode>
      <App bridge={bridge} dailySeed={getDailySeed()} />
    </StrictMode>,
  );
});
