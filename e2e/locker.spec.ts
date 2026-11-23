// Customize Character (src/pages/Customize.tsx): a character picked there is
// saved in the browser, sent with the join, kept by the match server, named in
// friends' lobby rosters, and built into their bodies in the arena without a
// fault.
import { expect, test } from "./fixtures";
import { GUEST, HOST, intoArena, player } from "./helpers";

// encodeLook(starterLook(6)) and a ROCKER wearing a top hat (src/game/look.ts)
const NINJA = "208671893";
const ROCKER_CUSTOM = "209445114";

test("Customize Character saves what you pick, with no account", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /CUSTOMIZE CHARACTER/ }).click();
  await expect(page).toHaveURL(/\/customize$/);
  await expect(page.locator("[data-testid=locker-stage] canvas")).toBeVisible();
  // every shelf holds ten items
  for (const shelf of ["HAIR", "FACE", "HAT", "SHIRT", "PANTS", "SHOES", "EXTRA"]) {
    await page.locator(".lk-tabs button", { hasText: shelf }).click();
    await expect(page.locator("[data-testid=locker-items] button")).toHaveCount(10);
  }

  await page.locator(".lk-chars button", { hasText: "NINJA" }).click();
  await expect(page.locator(".lk-name")).toHaveText("NINJA");
  expect(await page.evaluate(() => localStorage.getItem("dd_look"))).toBe(NINJA);

  await page.locator(".lk-tabs button", { hasText: "HAT" }).click();
  await page.locator("[data-testid=locker-items] button", { hasText: "top hat" }).click();
  await expect(page.locator(".lk-name")).toHaveText("YOUR OWN");

  // still there after a reload, and RESET goes back to the character it came from
  await page.reload();
  await expect(page.locator(".lk-name")).toHaveText("YOUR OWN");
  await page.locator(".lk-chars button", { hasText: "NINJA" }).click();
  await page.locator(".lk-tabs button", { hasText: "SHOES" }).click();
  await page.locator("[data-testid=locker-items] button", { hasText: "sandals" }).click();
  await page.getByRole("button", { name: "RESET TO NINJA" }).click();
  expect(await page.evaluate(() => localStorage.getItem("dd_look"))).toBe(NINJA);
});

test("friends' characters are built in the arena without a fault", async ({ browser }) => {
  const offHost: string[] = [];
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  await hostContext.addInitScript(`localStorage.setItem("dd_look", ${JSON.stringify(NINJA)})`);
  await guestContext.addInitScript(`localStorage.setItem("dd_look", ${JSON.stringify(ROCKER_CUSTOM)})`);
  const host = await player(hostContext, HOST, offHost);
  const guest = await player(guestContext, GUEST, offHost);
  const errors: string[] = [];
  for (const page of [host, guest]) page.on("pageerror", (e) => errors.push(e.message));

  await intoArena(host, guest);
  // a bad look would throw while building the other player's body
  await host.waitForTimeout(1500);
  expect(errors).toEqual([]);

  await hostContext.close();
  await guestContext.close();
});

test("the lobby roster names each friend's character", async ({ browser }) => {
  const offHost: string[] = [];
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  await hostContext.addInitScript(`localStorage.setItem("dd_look", ${JSON.stringify(NINJA)})`);
  await guestContext.addInitScript(`localStorage.setItem("dd_look", ${JSON.stringify(ROCKER_CUSTOM)})`);
  const host = await player(hostContext, HOST, offHost);
  const guest = await player(guestContext, GUEST, offHost);

  await host.goto("/online?create=1&map=district&grapple=1");
  await expect(host.locator(".dd-netcode")).toHaveText(/^[A-Z0-9]{4}$/, { timeout: 20_000 });
  const code = (await host.locator(".dd-netcode").textContent())!.trim();
  await guest.goto(`/online?room=${code}`);
  for (const page of [host, guest]) {
    await expect(page.locator(".dd-roster")).toContainText("IN THE ROOM (2)", { timeout: 20_000 });
    await expect(page.locator(".dd-roster .row", { hasText: HOST })).toContainText("as NINJA");
    await expect(page.locator(".dd-roster .row", { hasText: GUEST })).toContainText("custom look");
  }

  await hostContext.close();
  await guestContext.close();
});
