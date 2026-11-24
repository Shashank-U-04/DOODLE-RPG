// The weapon rack, the player-versus-player table and the katana, as the
// engine uses them. The definitions live in server/src/shared/weapons.ts, the
// one copy the match server reads too, so the numbers players feel and the
// numbers the server applies cannot drift apart.
export {
  DEFAULT_WEAPON,
  KATANA_MELEE,
  PVP,
  WEAPON_NAMES,
  WEAPONS,
  type MeleeConfig,
  type WeaponDef,
} from "../../server/src/shared/weapons.js";

/**
 * What the HUD and menus call each rack slot: the real guns the models are
 * (src/game/guns.ts). The rack's ids (RIFLE, SHOTGUN, …) stay as they are,
 * because they are what goes over the wire and what the match server checks.
 */
export const WEAPON_LABEL: Record<string, string> = {
  RIFLE: "AK-47",
  SHOTGUN: "M1887",
  SNIPER: "AWM",
  KATANA: "KATANA",
  REVOLVER: "DESERT EAGLE",
};

export const weaponLabel = (name: string) => WEAPON_LABEL[name] ?? name;
