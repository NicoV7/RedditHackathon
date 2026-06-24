/**
 * src/client/ui/BoardPanel.tsx — React side panel around the Phaser Deduction
 * Board. Per-NPC role tagging (suspect/bystander/killer/unknown), a deduction-
 * strength readout, and the Accuse button (enabled ONLY when an NPC is tagged
 * 'killer'). The Phaser board itself is mounted by App.tsx via the bridge; this
 * panel is the React chrome around it.
 *
 * Tagging here emits a nomination both to the FSM (onTag) and, through App, to
 * the Phaser board handle. The client never knows the killer — it only sends the
 * hypothesis.
 */
import type { ClientNpcView, NominationRole } from "../../shared/api.js";
import type { GameData } from "../state/fsm.js";
import { deductionStrength, nominatedKiller } from "../state/fsm.js";
import { noir, font } from "./theme.js";

const ROLES: NominationRole[] = ["unknown", "bystander", "suspect", "killer"];

export interface BoardPanelProps {
  data: GameData;
  /** the Phaser board canvas host — App mounts the scene into this ref's node */
  boardHostRef: React.RefObject<HTMLDivElement | null>;
  onTag: (npcId: string, role: NominationRole) => void;
  onClose: () => void;
  onAccuse: (npcId: string) => void;
}

export function BoardPanel(props: BoardPanelProps): React.JSX.Element {
  const { data } = props;
  const suspects = data.view.npcs.filter((n) => data.view.suspectIds.includes(n.id));
  const accusedId = nominatedKiller(data);

  return (
    <div style={styles.screen}>
      <header style={styles.header}>
        <button type="button" style={styles.back} onClick={props.onClose}>
          ‹ Back to the parlor
        </button>
        <div style={styles.title}>Deduction Board</div>
        <div style={styles.clueCount}>{data.clues.length} clues</div>
      </header>

      {/* Phaser red-string board mounts here (owned by App via the bridge). */}
      <div ref={props.boardHostRef} style={styles.boardHost} />

      <div style={styles.panel}>
        <div style={styles.panelTitle}>Tag the room</div>
        <ul style={styles.suspectList}>
          {suspects.map((n) => (
            <SuspectRow
              key={n.id}
              npc={n}
              role={data.nominations[n.id] ?? "unknown"}
              strength={deductionStrength(data, n.id)}
              onTag={(role) => props.onTag(n.id, role)}
            />
          ))}
        </ul>

        <button
          type="button"
          style={{ ...styles.accuse, ...(accusedId ? null : styles.accuseDisabled) }}
          disabled={!accusedId}
          onClick={() => accusedId && props.onAccuse(accusedId)}
        >
          {accusedId
            ? `Accuse ${nameOf(suspects, accusedId)}`
            : "Tag a killer to accuse"}
        </button>
      </div>
    </div>
  );
}

function SuspectRow(props: {
  npc: ClientNpcView;
  role: NominationRole;
  strength: number;
  onTag: (role: NominationRole) => void;
}): React.JSX.Element {
  const { npc, role, strength } = props;
  return (
    <li style={styles.suspectRow}>
      <div style={styles.suspectHead}>
        <span style={styles.suspectName}>{npc.name}</span>
        <span style={styles.strengthWrap} title={`deduction strength ${Math.round(strength * 100)}%`}>
          <span
            style={{
              ...styles.strengthFill,
              width: `${Math.round(strength * 100)}%`,
              background: role === "killer" ? noir.crimson : noir.amber,
            }}
          />
        </span>
      </div>
      <div style={styles.roleRow}>
        {ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => props.onTag(r)}
            style={{
              ...styles.roleChip,
              ...(role === r ? styles.roleChipActive : null),
              ...(role === r && r === "killer" ? styles.roleChipKiller : null),
            }}
          >
            {r}
          </button>
        ))}
      </div>
    </li>
  );
}

function nameOf(npcs: ClientNpcView[], id: string): string {
  return npcs.find((n) => n.id === id)?.name ?? id;
}

const styles: Record<string, React.CSSProperties> = {
  screen: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: noir.room,
    color: noir.paper,
    fontFamily: font,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderBottom: `1px solid ${noir.ink}`,
  },
  back: {
    background: "transparent",
    color: noir.amber,
    border: "none",
    fontSize: 15,
    cursor: "pointer",
    fontFamily: font,
  },
  title: { flex: 1, textAlign: "center", fontWeight: 700, color: noir.amber },
  clueCount: { fontSize: 12, color: noir.paperDim },
  boardHost: {
    flex: "0 0 auto",
    height: 220,
    margin: 12,
    borderRadius: 10,
    background: noir.ink,
    border: `1px solid ${noir.amber}55`,
    overflow: "hidden",
  },
  panel: { flex: 1, overflowY: "auto", padding: "0 16px 16px" },
  panelTitle: { fontSize: 13, letterSpacing: 1, color: noir.amber, margin: "8px 0 10px" },
  suspectList: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 },
  suspectRow: {
    background: "rgba(233,222,201,0.06)",
    borderRadius: 10,
    padding: 10,
  },
  suspectHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
  suspectName: { flex: "0 0 auto", fontWeight: 700, fontSize: 15 },
  strengthWrap: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    background: noir.ink,
    overflow: "hidden",
  },
  strengthFill: { display: "block", height: "100%", borderRadius: 999 },
  roleRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  roleChip: {
    flex: "1 1 auto",
    background: noir.paper,
    color: noir.ink,
    border: "none",
    borderRadius: 999,
    padding: "8px 10px",
    fontSize: 12,
    textTransform: "capitalize",
    cursor: "pointer",
    fontFamily: font,
    minHeight: 38,
  },
  roleChipActive: { background: noir.amber, fontWeight: 700 },
  roleChipKiller: { background: noir.crimson, color: noir.paper },
  accuse: {
    marginTop: 16,
    width: "100%",
    padding: "16px 20px",
    fontSize: 17,
    fontWeight: 700,
    fontFamily: font,
    color: noir.paper,
    background: noir.crimson,
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
    minHeight: 56,
  },
  accuseDisabled: {
    background: noir.ink,
    color: noir.paperDim,
    cursor: "not-allowed",
  },
};
