// Customize Character (src/pages/Customize.tsx): the battle character picked
// there is saved in the browser, sent with the join, kept by the match server,
// named in friends' lobby rosters, and loaded as their body in the arena.
import { expect, test } from "./fixtures";
import { GUEST, HOST, intoArena, player } from "./helpers";

// encodeLook({ char }) for SWAT (0) and HAZMAT (2) (src/game/look.ts)
const SWAT = "30";
const HAZMAT = "32";
const CHARACTERS = 20;
// BANANA (15) has no skeleton of its own: the game rigs it at load time (src/game/autorig.ts)
const BANANA = "3f";

test("Customize Character saves the fighter you pick, with no account", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /CUSTOMIZE CHARACTER/ }).click();
  await expect(page).toHaveURL(/\/customize$/);
  await expect(page.locator("[data-testid=locker-stage] canvas")).toBeVisible();
  await expect(page.locator("[data-testid=locker-items] button")).toHaveCount(CHARACTERS);

  await page.locator("[data-testid=locker-items] button", { hasText: "HAZMAT" }).click();
  await expect(page.locator(".lk-name")).toHaveText("HAZMAT");
  expect(await page.evaluate(() => localStorage.getItem("dd_look"))).toBe(HAZMAT);

  await page.reload();
  await expect(page.locator(".lk-name")).toHaveText("HAZMAT");
  await expect(page.locator("[data-testid=locker-items] button.on")).toContainText("HAZMAT");
});

test("a friend's fighter, even an auto-rigged one, is loaded as their body in the arena", async ({ browser }) => {
  const offHost: string[] = [];
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  await hostContext.addInitScript(`localStorage.setItem("dd_look", ${JSON.stringify(SWAT)})`);
  await guestContext.addInitScript(`localStorage.setItem("dd_look", ${JSON.stringify(BANANA)})`);
  const host = await player(hostContext, HOST, offHost);
  const guest = await player(guestContext, GUEST, offHost);
  const errors: string[] = [];
  for (const page of [host, guest]) page.on("pageerror", (e) => errors.push(e.message));

  // the host's game fetches the guest's model, and the guest's fetches the host's
  const hostGetsBanana = host.waitForResponse((r) => r.url().endsWith("/characters/banana.glb") && r.ok(), { timeout: 60_000 });
  const guestGetsSwat = guest.waitForResponse((r) => r.url().endsWith("/characters/swat.glb") && r.ok(), { timeout: 60_000 });
  await intoArena(host, guest);
  await Promise.all([hostGetsBanana, guestGetsSwat]);
  await host.waitForTimeout(1500);
  expect(errors).toEqual([]);

  await hostContext.close();
  await guestContext.close();
});

test("the lobby roster names each friend's fighter", async ({ browser }) => {
  const offHost: string[] = [];
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  await hostContext.addInitScript(`localStorage.setItem("dd_look", ${JSON.stringify(SWAT)})`);
  await guestContext.addInitScript(`localStorage.setItem("dd_look", ${JSON.stringify(HAZMAT)})`);
  const host = await player(hostContext, HOST, offHost);
  const guest = await player(guestContext, GUEST, offHost);

  await host.goto("/online?create=1&map=district&grapple=1");
  await expect(host.locator(".dd-netcode")).toHaveText(/^[A-Z0-9]{4}$/, { timeout: 20_000 });
  const code = (await host.locator(".dd-netcode").textContent())!.trim();
  await guest.goto(`/online?room=${code}`);
  for (const page of [host, guest]) {
    await expect(page.locator(".dd-roster")).toContainText("IN THE ROOM (2)", { timeout: 20_000 });
    await expect(page.locator(".dd-roster .row", { hasText: HOST })).toContainText("as SWAT");
    await expect(page.locator(".dd-roster .row", { hasText: GUEST })).toContainText("as HAZMAT");
  }

  await hostContext.close();
  await guestContext.close();
});
