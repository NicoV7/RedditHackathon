# PixelLab asset generation — manifest & wiring plan

Generated via the PixelLab MCP (subscription Tier 1). Style: Cold-Lovecraftian-Noir,
1920s, low top-down (3/4 RPG), 8 directions, 48px, single black outline, pixel art.

## Download format (from the docs)
- **Characters:** `get_character(id)` when `completed` returns rotation URLs + a download link
  `https://api.pixellab.ai/mcp/characters/{id}/download` → a **ZIP of per-direction PNGs**
  (no auth — the UUID is the key). 8 directions: south, west, east, north, south-east,
  north-east, north-west, south-west. No built-in spritesheet — assemble the 8 frames ourselves.
- **Tilesets (Wang):** `get_topdown_tileset(id)` returns download links for a **metadata JSON +
  sprite-sheet PNG**. 16 tiles; each tile has `corners {NW,NE,SW,SE}` ∈ upper|lower and a
  `bounding_box`. Wang index = `NW*8 + NE*4 + SW*2 + SE*1`. Render a map by sampling 4 corner
  terrain vertices per cell → index → tile.

## Character IDs (overworld cast)
| Name | Role | character_id |
|---|---|---|
| Detective (avatar) | player | 04e6ed74-4625-4eba-b101-d81127d009aa |
| Lola Marsh | suspect — singer | 6541a48c-5459-4466-9700-fdf559372990 |
| Don Vittorio | suspect — boss | da290fa4-ea5c-476c-8e89-d5b860b8530f |
| Frankie Conti | suspect — enforcer | b927afa6-3cc8-4469-90b9-67902e20c800 |
| Sil Greco | suspect — accountant | 08657fc6-9090-47ca-b1c3-9359b1556058 |
| Roy Halloran | suspect — cop | 3d8fd272-e328-4d23-ba70-58695fe0a3e1 |
| Augie Doyle | suspect — barkeep | 21cea732-f588-4f82-97e7-0618aff9b2ba |
| Nell Carraway | suspect — server | faebf674-04ff-41f5-a546-a15e13e8356c |
| Mr. Ash | suspect — envoy | 163107ec-a33d-430b-a221-b101e3c20dc0 |
| Old Cobb | witness — piano | ecdab16b-6d34-4ca5-9ab5-c6eabbf04d76 |
| Birdie | witness — coat-check | 118b571f-c04c-40e6-8735-4a193a279795 |
| Harlan | witness — regular | 7f9fe330-2d09-4e1c-9d09-f68fe2b25d6a |

## Tileset IDs (zone floors)
| Zone | terrain | tileset_id |
|---|---|---|
| bar / vip | oak floorboards → teal/gold art-deco rug | aaa1ca24-1193-4773-a6b6-04f4ae92e4d4 |
| alley | wet cobblestones → oily puddle | f516bb22-6ecf-4bbd-bf00-a12a64ab54f8 |
| parking lot | cracked asphalt → concrete curb | 87edc4ad-4a96-48a9-98df-8903c3bf51d9 |

## Wiring plan (Phaser, world.ts — cosmetic only, never read by logic)
1. Download each character ZIP → extract the 8 static directional PNGs → montage into one
   horizontal 8-frame spritesheet `src/client/assets/sprites/<name>.png` (frame order S,SE,E,NE,N,NW,W,SW).
2. Download each tileset's sprite PNG + metadata JSON → `src/client/assets/tilesets/<zone>.png` + `.json`.
3. world.ts preload(): load the sprite sheets + tileset images (via the existing assets.ts manifest).
4. Render NPCs + avatar as 8-direction sprites (pick the frame nearest the movement heading) instead
   of circles; render each zone floor from its Wang tileset (or a representative tile as a repeating
   floor) under the existing dynamic lighting. Keep the low-FX fallback when an asset is absent.
