import type { GenerationPacket, VisualAnchor } from "./prepare-generation-tools.js";

export const DELIVERY_CAP = 6;

const LOCATION_TOKEN_STOPLIST = new Set([
  "david",
  "juan",
  "mambo",
  "couple",
  "together",
  "natural",
  "portrait",
  "photograph",
  "identity",
  "priority",
  "anchor",
  "reference",
  "subject",
  "scene",
  "light",
  "camera",
  "photo",
  "image",
  "approved",
  "primary",
  "frontal",
  "support",
  "master",
  "pack",
  "window",
  "room",
]);

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function tokens(value: string): string[] {
  return fold(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 5 && !LOCATION_TOKEN_STOPLIST.has(token));
}

function label(anchor: VisualAnchor): string {
  return fold(`${anchor.file_name || ""} ${anchor.asset_id || ""} ${anchor.role || ""}`);
}

function sceneText(packet: GenerationPacket): string {
  return fold(packet.scene_text || "");
}

function isBody(anchor: VisualAnchor): boolean {
  return anchor.role === "Body Anchor" || /cuerpo|body anchor|mapa tatuaje|tattoo map/.test(label(anchor));
}

function blocksGlasses(anchor: VisualAnchor, scene: string): boolean {
  return /lentes|gafas|sunglasses|glasses/.test(label(anchor)) && !/lentes|gafas|sunglasses|glasses/.test(scene);
}

function isProfile(anchor: VisualAnchor): boolean {
  return /perfil|profile/.test(label(anchor));
}

function copyRiskForScene(anchor: VisualAnchor, scene: string): boolean {
  const beach = /playa|beach|pool|piscina|roca|costa/.test(scene);
  return beach && /hoodie|sueter|sweater|tank/.test(label(anchor));
}

function complementRank(anchor: VisualAnchor, scene: string): number | null {
  if (isBody(anchor) || isProfile(anchor) || blocksGlasses(anchor, scene) || copyRiskForScene(anchor, scene)) {
    return null;
  }
  const name = label(anchor);
  if (/tres cuartos|three quarter|three-quarter/.test(name)) return 30;
  if (/sonrisa|smile|laugh/.test(name)) return /risa|sonrisa|laugh|smile/.test(scene) ? 25 : 15;
  if (/frontal|primary/.test(name)) return null;
  return 8;
}

function sceneNeedsBody(scene: string): boolean {
  return /tatuaj|tattoo|proporci|cuerpo|shirtless|sin camisa/.test(scene);
}

function locationMatches(anchor: VisualAnchor, scene: string): boolean {
  if (anchor.role !== "Room Anchor" && anchor.role !== "Location Anchor") return false;
  const sceneTokens = new Set(tokens(scene));
  return tokens(`${anchor.file_name || ""} ${anchor.asset_id || ""}`).some((token) =>
    sceneTokens.has(token)
  );
}

function pushUnique(target: VisualAnchor[], anchor: VisualAnchor | null | undefined) {
  if (!anchor?.file_id) return;
  if (target.some((item) => item.file_id === anchor.file_id)) return;
  target.push(anchor);
}

function lookup(packet: GenerationPacket, id: string): VisualAnchor | undefined {
  const pool = [
    ...packet.reference_files,
    ...packet.identity_authority.map((item) => item.primary_identity_anchor),
    ...packet.identity_authority.flatMap((item) => item.priority_0_refs),
    ...packet.identity_authority.map((item) => item.body_anchor),
    ...packet.location_anchors,
    ...packet.relationship_anchors,
  ];
  return pool.find(
    (candidate): candidate is VisualAnchor =>
      Boolean(candidate && (candidate.file_id === id || candidate.asset_id === id) && candidate.file_id)
  );
}

export function selectDeliveryAnchors(
  packet: GenerationPacket,
  requiredIds: string[]
): { selected: VisualAnchor[]; unresolvedRequiredIds: string[] } {
  const scene = sceneText(packet);
  const required: VisualAnchor[] = [];
  const unresolvedRequiredIds: string[] = [];
  for (const id of requiredIds) {
    const anchor = lookup(packet, id);
    if (!anchor) {
      unresolvedRequiredIds.push(id);
      continue;
    }
    pushUnique(required, anchor);
  }

  const primaries: VisualAnchor[] = [];
  for (const authority of packet.identity_authority) {
    pushUnique(primaries, authority.primary_identity_anchor);
  }

  const humans = packet.subjects.filter((subject) => subject !== "Mambo");
  const automatic: VisualAnchor[] = [];
  const quality = packet.credit_mode === "QUALITY" && packet.subjects.length < 3 && humans.length > 0;
  if (quality) {
    for (const subject of humans) {
      const authority = packet.identity_authority.find((item) => item.subject === subject);
      if (!authority) continue;
      const primaryId = authority.primary_identity_anchor?.file_id;
      const ranked = authority.priority_0_refs
        .filter((anchor) => anchor.file_id && anchor.file_id !== primaryId)
        .map((anchor) => ({ anchor, rank: complementRank(anchor, scene) }))
        .filter((item): item is { anchor: VisualAnchor; rank: number } => item.rank !== null)
        .sort((a, b) => b.rank - a.rank);
      if (ranked[0]) pushUnique(automatic, ranked[0].anchor);
    }

    const location = packet.location_anchors.find((anchor) => locationMatches(anchor, scene));
    pushUnique(automatic, location);

    const roomLeft = DELIVERY_CAP - (primaries.length + required.length + automatic.length);
    if (roomLeft > 0 && sceneNeedsBody(scene)) {
      const body = packet.identity_authority.map((item) => item.body_anchor).find((anchor) => anchor && isBody(anchor));
      pushUnique(automatic, body);
    } else if (roomLeft > 0 && humans.length === 2) {
      pushUnique(automatic, packet.relationship_anchors[0]);
    }
  }

  const selected = [...primaries];
  for (const anchor of required) pushUnique(selected, anchor);
  const room = Math.max(0, DELIVERY_CAP - selected.length);
  for (const anchor of automatic.slice(0, room)) pushUnique(selected, anchor);

  return { selected, unresolvedRequiredIds };
}
