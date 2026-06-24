/**
 * src/client/phaser/index.ts — Phaser layer entrypoint.
 *
 * Exposes `createPhaserBridge()`, the concrete implementation of the
 * `PhaserBridge` contract (src/client/bridge.ts) that the React shell mounts.
 * Phaser owns pixels + input only; all game state lives in the shell and is
 * reached exclusively through the handler callbacks. This module is the single
 * seam between the two halves of the client.
 */
import type { PhaserBridge } from "../bridge.js";
import { mountWorld } from "./world.js";
import { mountBoard } from "./board.js";

export function createPhaserBridge(): PhaserBridge {
  return {
    mountWorld,
    mountBoard,
  };
}

/** Concrete bridge consumed by the React shell (main.tsx imports `bridge`). */
export const bridge: PhaserBridge = createPhaserBridge();

export { mountWorld } from "./world.js";
export { mountBoard } from "./board.js";
