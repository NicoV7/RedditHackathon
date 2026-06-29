/**
 * src/client/ui/Inventory.tsx — the collected-evidence panel (Part 2.3 inventory +
 * the Present verb). A compact, mobile-first list of every item the player has
 * picked up (examined), shown as a slide-up tray in the overworld so the player can
 * see what they're carrying before they Present it inside an interrogation.
 *
 * Presentational only: `inventory` is the FSM's collected-item ids; `items` resolves
 * each id to a human label (the case view carries no examineText — that's revealed
 * server-side per examine — so we label by item kind + zone). Tapping an item is a
 * no-op affordance here (Present lives inside the dialogue, where there's an NPC to
 * present TO); this panel is the "what do I have" readout.
 */
import { useMemo } from "react";
import type { ClientItemView } from "../../shared/api.js";
import { noir, font } from "./theme.js";

export interface InventoryProps {
  /** collected item ids (FSM `inventory`). */
  inventory: string[];
  /** the case items, to resolve an id → a label + zone. */
  items: ClientItemView[];
  open: boolean;
  onToggle: () => void;
}

export function Inventory(props: InventoryProps): React.JSX.Element {
  const { inventory, items, open } = props;
  const rows = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i] as const));
    return inventory.map((id) => {
      const it = byId.get(id);
      return {
        id,
        label: it ? kindLabel(it.kind) : id,
        zone: it?.zone ?? "",
      };
    });
  }, [inventory, items]);

  return (
    <div style={styles.wrap}>
      <button
        type="button"
        style={{ ...styles.toggle, ...(inventory.length === 0 ? styles.toggleEmpty : null) }}
        onClick={props.onToggle}
        aria-expanded={open}
      >
        🜍 Evidence
        <span style={styles.count}>{inventory.length}</span>
      </button>
      {open && (
        <div style={styles.tray} aria-label="Collected evidence">
          {rows.length === 0 ? (
            <div style={styles.empty}>
              Nothing pocketed yet. Examine what the room left behind.
            </div>
          ) : (
            <ul style={styles.list}>
              {rows.map((r) => (
                <li key={r.id} style={styles.item}>
                  <span style={styles.itemGlyph} aria-hidden>
                    ◆
                  </span>
                  <span style={styles.itemLabel}>{r.label}</span>
                  {r.zone && <span style={styles.itemZone}>{r.zone}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** kebab/snake item kind → Title Case ("torn_letter" → "Torn Letter"). */
function kindLabel(kind: string): string {
  return kind
    .split(/[_\s-]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { position: "relative", flex: "0 0 auto" },
  toggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: noir.slate,
    color: noir.paper,
    border: `1px solid ${noir.amber}55`,
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 13,
    fontFamily: font,
    cursor: "pointer",
    minHeight: 48,
  },
  toggleEmpty: { color: noir.paperDim, borderColor: "#1c302c" },
  count: {
    background: noir.amber,
    color: noir.ink,
    borderRadius: 999,
    padding: "1px 8px",
    fontSize: 12,
    fontWeight: 700,
  },
  tray: {
    position: "absolute",
    bottom: "calc(100% + 8px)",
    left: 0,
    minWidth: 220,
    maxWidth: 300,
    maxHeight: 260,
    overflowY: "auto",
    background: noir.slate,
    border: `1px solid ${noir.amber}55`,
    borderRadius: 12,
    boxShadow: "0 12px 36px rgba(0,0,0,0.55)",
    padding: 10,
    zIndex: 6,
  },
  empty: { fontSize: 13, color: noir.paperDim, lineHeight: 1.45, padding: 6 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 },
  item: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    background: "rgba(191,210,202,0.06)",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 13.5,
  },
  itemGlyph: { color: noir.amber, fontSize: 10, flex: "0 0 auto" },
  itemLabel: { flex: 1, color: noir.paper },
  itemZone: { color: noir.paperDim, fontSize: 11.5, fontStyle: "italic", flex: "0 0 auto" },
};
