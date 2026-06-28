import { describe, it, expect } from "vitest";
import { noir, font, FACULTY_META, facultyMeta } from "./theme.js";

// ─── noir palette ────────────────────────────────────────────────────────────

describe("noir palette", () => {
  it("exports every required token key", () => {
    const requiredKeys = [
      "room",
      "slate",
      "abyss",
      "amber",
      "paper",
      "paperDim",
      "crimson",
      "ink",
      "green",
    ] as const;
    for (const key of requiredKeys) {
      expect(noir).toHaveProperty(key);
    }
  });

  it("every token value is a 7-character hex colour string", () => {
    for (const [key, value] of Object.entries(noir)) {
      expect(
        typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value),
        `noir.${key} = "${value}" is not a valid #RRGGBB hex colour`
      ).toBe(true);
    }
  });

  it("crimson is the only red-dominant token (signature / lie-tell boundary)", () => {
    // crimson must have R > G and R > B (red dominant).
    const hex = noir.crimson;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);

    // No other token should be red-dominant, keeping crimson truly unique.
    for (const [key, value] of Object.entries(noir)) {
      if (key === "crimson") continue;
      const tr = parseInt((value as string).slice(1, 3), 16);
      const tg = parseInt((value as string).slice(3, 5), 16);
      const tb = parseInt((value as string).slice(5, 7), 16);
      expect(
        tr > tg && tr > tb,
        `noir.${key} is unexpectedly red-dominant`
      ).toBe(false);
    }
  });

  it("room, slate, abyss are progressively darker (cold-depth ordering)", () => {
    const luminance = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    expect(luminance(noir.room)).toBeGreaterThan(luminance(noir.slate));
    expect(luminance(noir.slate)).toBeGreaterThan(luminance(noir.abyss));
  });

  it("font is a non-empty string", () => {
    expect(typeof font).toBe("string");
    expect(font.length).toBeGreaterThan(0);
  });
});

// ─── FACULTY_META completeness ────────────────────────────────────────────────

describe("FACULTY_META completeness", () => {
  const EXPECTED_FACULTIES = [
    "logic",
    "empathy",
    "drama",
    "perception",
    "authority",
    "encyclopedia",
  ] as const;

  it("contains exactly the six expected faculty ids", () => {
    const keys = Object.keys(FACULTY_META).sort();
    expect(keys).toEqual([...EXPECTED_FACULTIES].sort());
  });

  it("every faculty has a non-empty string label and glyph", () => {
    for (const id of EXPECTED_FACULTIES) {
      const entry = FACULTY_META[id]!;
      expect(typeof entry.label, `${id}.label type`).toBe("string");
      expect(entry.label.length, `${id}.label length`).toBeGreaterThan(0);
      expect(typeof entry.glyph, `${id}.glyph type`).toBe("string");
      expect(entry.glyph.length, `${id}.glyph length`).toBeGreaterThan(0);
    }
  });

  it("SPINE faculties (logic, empathy) are present with correct labels", () => {
    expect(FACULTY_META["logic"]!.label).toBe("Logic");
    expect(FACULTY_META["empathy"]!.label).toBe("Empathy");
  });

  it("STRETCH faculties (drama, perception, authority, encyclopedia) are present", () => {
    for (const id of ["drama", "perception", "authority", "encyclopedia"]) {
      expect(FACULTY_META).toHaveProperty(id);
    }
  });

  it("glyphs are unique across all faculties", () => {
    const glyphs = Object.values(FACULTY_META).map((m) => m.glyph);
    const unique = new Set(glyphs);
    expect(unique.size).toBe(glyphs.length);
  });

  it("labels are unique across all faculties", () => {
    const labels = Object.values(FACULTY_META).map((m) => m.label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });
});

// ─── facultyMeta() lookup and fallback ───────────────────────────────────────

describe("facultyMeta()", () => {
  it("returns the correct entry for every known faculty id", () => {
    for (const [id, meta] of Object.entries(FACULTY_META)) {
      expect(facultyMeta(id)).toEqual(meta);
    }
  });

  it("returns the exact label and glyph for 'logic'", () => {
    const result = facultyMeta("logic");
    expect(result.label).toBe("Logic");
    expect(result.glyph).toBe("⟁");
  });

  it("returns the exact label and glyph for 'empathy'", () => {
    const result = facultyMeta("empathy");
    expect(result.label).toBe("Empathy");
    expect(result.glyph).toBe("♥");
  });

  it("returns fallback { label: faculty, glyph: '•' } for an unknown id", () => {
    const unknown = "unknown_faculty_xyz";
    const result = facultyMeta(unknown);
    expect(result.label).toBe(unknown);
    expect(result.glyph).toBe("•");
  });

  it("fallback preserves the exact unknown id as the label", () => {
    const weirdId = "🧿spectral";
    const result = facultyMeta(weirdId);
    expect(result.label).toBe(weirdId);
    expect(result.glyph).toBe("•");
  });

  it("empty string id falls back gracefully", () => {
    const result = facultyMeta("");
    expect(result.label).toBe("");
    expect(result.glyph).toBe("•");
  });

  it("case-sensitive: 'Logic' (titlecase) is not a known id and falls back", () => {
    const result = facultyMeta("Logic");
    expect(result.label).toBe("Logic");
    expect(result.glyph).toBe("•");
  });

  it("returns a plain object with exactly two keys: label and glyph", () => {
    const result = facultyMeta("drama");
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(["glyph", "label"]);
  });
});
