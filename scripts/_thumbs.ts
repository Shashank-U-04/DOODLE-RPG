// dev helper, run in the browser through the dev server: render every character card
import { createThumbnailer } from "../src/game/preview";
import { CHARACTER_LIST } from "../src/game/characters";

export async function renderThumbs(turn = 0.5) {
  const t = createThumbnailer();
  const out: { id: string; url: string | null }[] = [];
  for (let i = 0; i < CHARACTER_LIST.length; i++) out.push({ id: CHARACTER_LIST[i].id, url: await t.shot(i, turn) });
  t.dispose();
  return out;
}
