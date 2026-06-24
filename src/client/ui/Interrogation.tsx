/**
 * src/client/ui/Interrogation.tsx — the dialogue stage (Cold Lovecraftian Noir).
 *
 * Disco-Elysium two-panel layout: the suspect's PORTRAIT on the LEFT (the face is
 * the focus + where the lie-tell FILTER lives — Pillar 1), the conversation on the
 * RIGHT — running transcript, an in-character "…thinking" state, an inner-voice
 * Faculties rail (italic crimson), server-authored crimson clue-cards, question
 * chips (asked chips gray out), a Present-evidence affordance, and a bounded
 * free-text input (≤140 chars, moderated server-side — the content-rule guardrail).
 *
 * THE LIE-TELL (Part 1.2 dual-signal): a tell is a DETERMINISTIC, SERVER-AUTHORED
 * `TellSignal` (fired from a structural `statedLie` + the player's faculty level).
 * This panel RENDERS it two ways — the portrait filter (via the Phaser PortraitHandle)
 * and the inner-voice rail — but NEVER reads the visual back into logic, and never
 * string-matches the LLM prose to inject highlights (the clue arrives as its own
 * server-authored crimson card). Both are cosmetic projections of the same signal.
 *
 * Presentational + local input state only; the fetch + FSM dispatch live in App.tsx.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ClientItemView,
  ClientNpcView,
  RevealedClue,
  TellSignal,
} from "../../shared/api.js";
import type { PhaserBridge, PortraitHandle } from "../bridge.js";
import { noir, font, facultyMeta } from "./theme.js";
import { portraitFor } from "./portraits.js";

const MAX_INPUT = 140; // bounded free-text (no unbounded input — compliance)

// One-time keyframe injection for the cosmetic "gotcha" shake. Guarded so it runs
// once, only in the browser, and respects reduced-motion via the media query (the
// shake collapses to no transform). Purely presentational — no logic depends on it.
const GOTCHA_STYLE_ID = "parlor-gotcha-keyframes";
function ensureGotchaKeyframes(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(GOTCHA_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = GOTCHA_STYLE_ID;
  el.textContent = `
    @keyframes parlorGotcha {
      0%,100% { transform: translateX(0); }
      15% { transform: translateX(-6px); }
      30% { transform: translateX(5px); }
      45% { transform: translateX(-4px); }
      60% { transform: translateX(3px); }
      75% { transform: translateX(-2px); }
    }
    .parlor-gotcha { animation: parlorGotcha 420ms cubic-bezier(.36,.07,.19,.97) both; }
    @media (prefers-reduced-motion: reduce) {
      .parlor-gotcha { animation: none !important; }
    }
  `;
  document.head.appendChild(el);
}

const DEFAULT_CHIPS = [
  "Where were you last night?",
  "Did you know the victim?",
  "Who do you suspect?",
  "What did you see?",
  "Do you have an alibi?",
] as const;

export interface InterrogationLine {
  speaker: "you" | "npc";
  text: string;
}

export interface InterrogationProps {
  npc: ClientNpcView;
  transcript: InterrogationLine[];
  /** every clue collected so far (server-authoritative; rendered as crimson cards). */
  clues: RevealedClue[];
  /** clue ids surfaced by THIS NPC's last turn (highlighted as fresh). */
  freshClueIds: string[];
  askedChips: string[];
  thinking: boolean;
  /** the latest lie-tell for this NPC, if any (drives the rail + portrait filter). */
  tell?: TellSignal | null;
  /** collected item ids the player can Present to this NPC (the "gotcha"). */
  inventory: string[];
  /** the case items (to resolve an inventory id → a human label). */
  items: ClientItemView[];
  /** the Phaser bridge — used to mount the portrait + drive the lie-tell filter. */
  bridge?: PhaserBridge;
  /** increments on a caught-in-a-lie present — triggers a cosmetic "gotcha" shake. */
  gotcha?: number;
  onAsk: (message: string) => void;
  /** present a collected item to this NPC → fires presentReactions server-side. */
  onPresent?: (itemId: string) => void;
  onBack: () => void;
}

export function Interrogation(props: InterrogationProps): React.JSX.Element {
  const { npc, transcript, clues, freshClueIds, askedChips, thinking, tell } = props;
  const [draft, setDraft] = useState("");
  const [presentOpen, setPresentOpen] = useState(false);

  const chips = useMemo(() => DEFAULT_CHIPS, []);
  const fresh = useMemo(() => new Set(freshClueIds), [freshClueIds]);
  const portrait = useMemo(() => portraitFor(npc.name), [npc.name]);

  // ── Phaser portrait layer (Pillar 1): mount over the <img> fallback. The handle
  //    drives the lie-tell filter. Guarded — a partial/no-op bridge stays valid, so
  //    the <img> beneath always renders even with no Phaser portrait layer. ──
  const portraitHostRef = useRef<HTMLDivElement | null>(null);
  const portraitHandle = useRef<PortraitHandle | null>(null);
  useEffect(() => {
    const host = portraitHostRef.current;
    const mount = props.bridge?.mountPortrait;
    if (host && mount) {
      portraitHandle.current = mount(host, npc.id);
    }
    return () => {
      portraitHandle.current?.destroy();
      portraitHandle.current = null;
    };
    // re-mount when the NPC changes (selects the right portrait art)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [npc.id]);

  // ── render the lie-tell filter whenever the server tell changes (cosmetic only;
  //    the rail below renders the SAME signal as italic-crimson inner voice). ──
  useEffect(() => {
    const h = portraitHandle.current;
    if (!h) return;
    if (tell) h.showTell(tell);
    else h.clearTell();
  }, [tell]);

  // ── the "gotcha" shake (Pillar 4 camera-shake analog): a brief cosmetic jitter
  //    on the portrait when a caught lie lands. PURELY presentational — driven by a
  //    server-authoritative `caughtInLie`, never read back into logic. ──
  const [shaking, setShaking] = useState(false);
  const gotcha = props.gotcha ?? 0;
  const firstGotcha = useRef(gotcha);
  useEffect(() => {
    if (gotcha === firstGotcha.current) return; // ignore the initial mount value
    ensureGotchaKeyframes();
    setShaking(true);
    const t = window.setTimeout(() => setShaking(false), 420);
    return () => window.clearTimeout(t);
  }, [gotcha]);

  function ask(message: string): void {
    const m = message.trim();
    if (!m || thinking) return;
    props.onAsk(m);
    setDraft("");
  }

  // resolve a collected item id → a human label (kind, fallback id)
  const labelFor = useMemo(() => {
    const byId = new Map(props.items.map((i) => [i.id, i] as const));
    return (id: string): string => {
      const it = byId.get(id);
      if (!it) return id;
      return `${itemKindLabel(it.kind)}`;
    };
  }, [props.items]);

  const inventory = props.inventory;
  const canPresent = !!props.onPresent && inventory.length > 0;

  return (
    <div style={styles.screen}>
      {/* LEFT — portrait stage */}
      <aside style={styles.portrait} className={shaking ? "parlor-gotcha" : undefined}>
        {/* fallback portrait image — always rendered; the Phaser layer paints over it */}
        <img src={portrait} alt={npc.name} style={styles.sprite} />
        {/* Phaser portrait host (lie-tell filter); empty/absent with the no-op bridge */}
        <div ref={portraitHostRef} style={styles.portraitFx} aria-hidden />
        <div style={styles.fog} />
        <button type="button" style={styles.back} onClick={props.onBack}>
          ‹ leave
        </button>
        <div style={styles.plate}>
          <div style={styles.npcName}>{npc.name}</div>
          <div style={styles.npcVoice}>{npc.blurb}</div>
        </div>
      </aside>

      {/* RIGHT — dialogue */}
      <section style={styles.talk}>
        <div style={styles.transcript}>
          {transcript.length === 0 && (
            <div style={styles.opening}>
              <em>{npc.name} regards you, waiting. ({npc.voice})</em>
            </div>
          )}
          {transcript.map((line, i) => (
            <div
              key={i}
              style={line.speaker === "you" ? styles.lineYou : styles.lineNpc}
            >
              {line.text}
            </div>
          ))}
          {thinking && (
            <div style={{ ...styles.lineNpc, ...styles.thinking }}>
              <em>{npc.name} considers the question…</em>
            </div>
          )}
        </div>

        {/* Faculties HUD — the inner-voice rail. Italic crimson stage-direction; the
            tell's faculty + line are server-authored, NEVER parsed from the LLM. */}
        {tell && <FacultyVoice tell={tell} />}

        {/* Server-authored crimson clue-cards. These are the ONLY crimson clue text —
            we never string-match the (untrusted) LLM prose to highlight inside it. */}
        {clues.length > 0 && (
          <div style={styles.clueRail} aria-label="Clues collected">
            {clues.map((c) => (
              <span
                key={c.id}
                style={{
                  ...styles.clueCard,
                  ...(fresh.has(c.id) ? styles.clueCardFresh : null),
                }}
              >
                <span style={styles.cluePin} aria-hidden>
                  ◆
                </span>
                {c.text}
              </span>
            ))}
          </div>
        )}

        {/* Present-evidence affordance (the "gotcha"). Picks a collected item → onPresent. */}
        {canPresent && (
          <div style={styles.presentWrap}>
            <button
              type="button"
              style={styles.presentToggle}
              disabled={thinking}
              onClick={() => setPresentOpen((o) => !o)}
            >
              {presentOpen ? "✕ never mind" : "▣ Present evidence"}
            </button>
            {presentOpen && (
              <div style={styles.presentTray} aria-label="Your evidence">
                {inventory.map((id) => (
                  <button
                    key={id}
                    type="button"
                    style={styles.presentItem}
                    disabled={thinking}
                    onClick={() => {
                      props.onPresent?.(id);
                      setPresentOpen(false);
                    }}
                  >
                    {labelFor(id)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={styles.chips}>
          {chips.map((c) => {
            const used = askedChips.includes(c);
            return (
              <button
                key={c}
                type="button"
                disabled={used || thinking}
                style={{ ...styles.chip, ...(used ? styles.chipUsed : null) }}
                onClick={() => ask(c)}
              >
                {c}
              </button>
            );
          })}
        </div>

        <form
          style={styles.inputRow}
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
        >
          <input
            style={styles.input}
            value={draft}
            maxLength={MAX_INPUT}
            placeholder="Press them in your own words…"
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_INPUT))}
            disabled={thinking}
          />
          <button
            type="submit"
            style={styles.send}
            disabled={thinking || draft.trim().length === 0}
          >
            Ask
          </button>
        </form>
      </section>
    </div>
  );
}

/** The inner-voice interjection rail — one Faculty speaking in italic crimson. */
function FacultyVoice({ tell }: { tell: TellSignal }): React.JSX.Element {
  const meta = facultyMeta(tell.faculty);
  return (
    <div style={styles.voiceRail} role="note" aria-label={`${meta.label} senses something`}>
      <span style={styles.voiceGlyph} aria-hidden>
        {meta.glyph}
      </span>
      <span style={styles.voiceBody}>
        <span style={styles.voiceFaculty}>{meta.label}</span>
        <span style={styles.voiceLine}> — {tell.line}</span>
      </span>
    </div>
  );
}

/** Human-readable label for an item kind (the inventory has no examineText). */
function itemKindLabel(kind: string): string {
  // kebab/snake → Title Case ("blood_stain" → "Blood Stain")
  return kind
    .split(/[_\s-]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const styles: Record<string, React.CSSProperties> = {
  screen: {
    height: "100%",
    display: "flex",
    background:
      "radial-gradient(140% 120% at 50% -10%, #15343a 0%, #0a2026 30%, #051419 60%, #04080b 100%)",
    color: noir.paper,
    fontFamily: font,
    overflow: "hidden",
  },
  // ── portrait ──
  portrait: {
    width: "42%",
    maxWidth: 460,
    position: "relative",
    overflow: "hidden",
    borderRight: `1px solid #14282c`,
    background:
      "radial-gradient(60% 56% at 50% 40%, rgba(120,170,160,.16), transparent 62%)",
    flex: "0 0 auto",
  },
  sprite: {
    position: "absolute",
    left: "50%",
    bottom: 0,
    transform: "translateX(-50%)",
    height: "99%",
    imageRendering: "pixelated",
    filter: "drop-shadow(0 6px 18px rgba(0,0,0,.55))",
  },
  // The Phaser lie-tell layer sits directly over the <img>, same footprint. It is
  // transparent when no tell is active; the <img> fallback shows through.
  portraitFx: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 1,
  },
  fog: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 2,
    background:
      "linear-gradient(180deg, transparent 52%, rgba(5,18,22,.5) 80%, rgba(4,14,18,.92))",
  },
  back: {
    position: "absolute",
    top: 12,
    left: 12,
    background: "rgba(4,8,10,.5)",
    color: noir.amber,
    border: "none",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 14,
    cursor: "pointer",
    fontFamily: font,
    zIndex: 3,
  },
  plate: { position: "absolute", left: 0, right: 0, bottom: 0, padding: "14px 16px", zIndex: 3 },
  npcName: { fontSize: 23, fontWeight: 700, color: "#e3efe8" },
  npcVoice: { fontSize: 12.5, color: noir.paperDim, fontStyle: "italic", marginTop: 3, lineHeight: 1.35 },
  // ── dialogue ──
  talk: { flex: 1, display: "flex", flexDirection: "column", padding: "20px 24px 16px", minWidth: 0 },
  transcript: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    overflowY: "auto",
    minHeight: 0,
    justifyContent: "flex-end",
  },
  opening: { color: noir.paperDim, fontSize: 15, lineHeight: 1.5 },
  lineYou: { alignSelf: "flex-end", maxWidth: "88%", color: "#9fb1ad", fontSize: 15, lineHeight: 1.5 },
  lineNpc: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    color: "#eef4ee",
    fontSize: 18,
    lineHeight: 1.55,
  },
  thinking: { opacity: 0.7 },
  // ── Faculties HUD (inner-voice rail) ──
  voiceRail: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    margin: "10px 0 2px",
    padding: "8px 11px",
    borderLeft: `2px solid ${noir.crimson}`,
    background: `${noir.crimson}12`,
    borderRadius: "0 8px 8px 0",
  },
  voiceGlyph: { color: noir.crimson, fontSize: 14, lineHeight: 1.5, flex: "0 0 auto" },
  voiceBody: { fontStyle: "italic", fontSize: 14.5, lineHeight: 1.5, color: noir.crimson },
  voiceFaculty: { fontWeight: 700, letterSpacing: 0.3 },
  voiceLine: { color: "#e7867f" },
  // ── clue cards (server-authored, crimson) ──
  clueRail: { display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 0 4px" },
  clueCard: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    color: "#f0d6d3",
    background: `${noir.crimson}1a`,
    border: `1px solid ${noir.crimson}66`,
    borderRadius: 6,
    padding: "5px 9px",
  },
  clueCardFresh: {
    borderColor: noir.crimson,
    boxShadow: `0 0 0 1px ${noir.crimson}, 0 0 10px ${noir.crimson}55`,
    color: "#ffeae7",
  },
  cluePin: { color: noir.crimson, fontSize: 10 },
  // ── present-evidence ──
  presentWrap: { margin: "10px 0 2px" },
  presentToggle: {
    fontFamily: font,
    fontSize: 12.5,
    color: noir.amber,
    background: "transparent",
    border: `1px solid #2c4a44`,
    borderRadius: 999,
    padding: "8px 13px",
    cursor: "pointer",
    minHeight: 38,
  },
  presentTray: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 },
  presentItem: {
    fontFamily: font,
    fontSize: 12.5,
    color: "#08181a",
    background: noir.amber,
    border: "none",
    borderRadius: 8,
    padding: "8px 12px",
    cursor: "pointer",
    minHeight: 38,
    fontWeight: 700,
  },
  chips: { display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0 10px" },
  chip: {
    fontFamily: font,
    fontSize: 12.5,
    color: "#cfe0d8",
    background: "transparent",
    border: `1px solid #2c4a44`,
    borderRadius: 999,
    padding: "8px 13px",
    cursor: "pointer",
    minHeight: 38,
  },
  chipUsed: { color: "#5d7068", borderColor: "#1c302c", cursor: "default" },
  inputRow: { display: "flex", gap: 8 },
  input: {
    flex: 1,
    background: "rgba(3,12,14,.7)",
    border: `1px solid #234039`,
    color: noir.paper,
    fontFamily: font,
    fontSize: 15,
    padding: "12px 14px",
    borderRadius: 8,
    minWidth: 0,
  },
  send: {
    background: noir.amber,
    color: "#08181a",
    border: "none",
    borderRadius: 8,
    padding: "0 18px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: font,
    minHeight: 46,
  },
};
