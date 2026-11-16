// Waking the match server from the menus (src/game/wake.ts), in the real pages.
//
// Picking PLAY WITH FRIENDS knocks on the match server's /health, and so does
// the setup screen whenever it is in friends mode, so a sleeping server is
// already waking while the player sets up the room. Knocks within a minute of
// each other are one knock. Opening the title screen and solo play send
// nothing. Nothing waits on a knock: a /health that never answers, or fails,
// must not slow down or stop any step of the way in.
import type { Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures";
import { HOST, player } from "./helpers";
import { E2E_SERVER } from "./env";

const HEALTH = `${E2E_SERVER}/health`;

/** Every /health request the page sends, in order, with the page's path at the time. */
function watchHealth(page: Page) {
  const knocks: { path: string }[] = [];
  page.on("request", (req: Request) => {
    if (req.url() === HEALTH) knocks.push({ path: new URL(page.url()).pathname });
  });
  return knocks;
}

/** Long enough for a knock fired on load to have shown up, were there one. */
const settle = (page: Page) => page.waitForTimeout(1_500);

/** Title → PLAY WITH FRIENDS → setup → CREATE ROOM; returns the room code the lobby shows. */
async function createFromTitle(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: /PLAY WITH FRIENDS/ }).click();
  await expect(page).toHaveURL(/\/setup\?.*mode=friends/);
  await page.getByRole("button", { name: /CREATE ROOM/ }).click();
  await expect(page).toHaveURL(/\/online/);
  await expect(page.locator(".dd-netcode")).toHaveText(/^[A-Z0-9]{4}$/, { timeout: 20_000 });
  return (await page.locator(".dd-netcode").textContent())!.trim();
}

test("opening the title screen sends nothing; PLAY WITH FRIENDS wakes the server, once for the whole way in", async ({ browser }) => {
  const offHost: string[] = [];
  const context = await browser.newContext();
  const page = await player(context, HOST, offHost);
  const knocks = watchHealth(page);

  await page.goto("/");
  await expect(page.getByRole("button", { name: /PLAY WITH FRIENDS/ })).toBeVisible();
  await settle(page);
  expect(knocks.length, "knocks from just opening the title screen").toBe(0);

  await page.getByRole("button", { name: /PLAY WITH FRIENDS/ }).click();
  await expect(page).toHaveURL(/\/setup\?.*mode=friends/);
  await expect.poll(() => knocks.length, { message: "a /health knock from PLAY WITH FRIENDS" }).toBe(1);

  // setup (in friends mode) and the lobby, within the repeat window: no second knock
  await page.getByRole("button", { name: /CREATE ROOM/ }).click();
  await expect(page.locator(".dd-netcode")).toHaveText(/^[A-Z0-9]{4}$/, { timeout: 20_000 });
  expect(knocks.length, "knocks from PLAY WITH FRIENDS → setup → lobby").toBe(1);
  // the knock goes only to the configured match server (fonts are allowed, as in startup.spec.ts)
  expect(offHost.filter((u) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u))).toEqual([]);
  await context.close();
});

test("opening the setup screen for friends directly knocks too", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await player(context, HOST, []);
  const knocks = watchHealth(page);
  await page.goto("/setup?mode=friends");
  await expect(page.getByRole("button", { name: /CREATE ROOM/ })).toBeVisible();
  await expect.poll(() => knocks.length, { message: "a /health knock from /setup?mode=friends" }).toBe(1);
  expect(knocks[0].path).toBe("/setup");
  await context.close();
});

test("switching the setup screen from solo to friends knocks", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await player(context, HOST, []);
  const knocks = watchHealth(page);
  await page.goto("/setup?mode=solo");
  await expect(page.getByRole("button", { name: /START MATCH/ })).toBeVisible();
  await settle(page);
  expect(knocks.length, "knocks from the solo setup screen").toBe(0);
  await page.getByRole("button", { name: /SWITCH TO PLAY WITH FRIENDS/ }).click();
  await expect(page.getByRole("button", { name: /CREATE ROOM/ })).toBeVisible();
  await expect.poll(() => knocks.length, { message: "a /health knock after switching to friends" }).toBe(1);
  await context.close();
});

for (const health of ["never answers", "fails"] as const) {
  test(`a /health that ${health} slows nothing down: title → setup → room code`, async ({ browser }) => {
    const context = await browser.newContext();
    const page = await player(context, HOST, []);
    const knocks = watchHealth(page);
    // page routes take precedence over the context's (helpers.ts)
    await page.route(HEALTH, (route) => {
      if (health === "fails") return route.abort();
      // never answered: the request stays open for the rest of the test
    });
    const code = await createFromTitle(page);
    expect(code).toMatch(/^[A-Z0-9]{4}$/);
    expect(knocks.length).toBeGreaterThanOrEqual(1);
    await context.close();
  });
}

test("solo play never knocks: title → PLAY VS COMPUTER → setup → the game", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await player(context, HOST, []);
  const knocks = watchHealth(page);

  await page.goto("/");
  await expect(page.getByRole("button", { name: /PLAY VS COMPUTER/ })).toBeVisible();
  await page.getByRole("button", { name: /PLAY VS COMPUTER/ }).click();
  await expect(page).toHaveURL(/\/setup\?.*mode=solo/);
  await page.getByRole("button", { name: /START MATCH/ }).click();
  await expect(page).toHaveURL(/\/game\?/);
  await expect(page.locator(".dd-stage canvas")).toHaveCount(1, { timeout: 60_000 });
  await settle(page);
  expect(knocks, "requests to the match server during solo play").toEqual([]);
  await context.close();
});
