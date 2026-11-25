// Touch play on an emulated phone held sideways: the on-screen controls appear,
// and real multi-finger touches move, look, fire, peek, switch weapons and lock
// a sprint. Touches go in through the DevTools protocol, as a finger's would.
import type { CDPSession, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { player } from "./helpers";

type Finger = { x: number; y: number; id: number };
const touch = (cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", touchPoints: Finger[]) =>
  cdp.send("Input.dispatchTouchEvent", { type, touchPoints });

/** the centre of a control, in CSS pixels */
async function centre(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** what the canvas shows right now, as a PNG */
const frame = (page: Page) => page.locator(".dd-stage canvas").screenshot();

test("a phone gets on-screen controls that move, look, fire, peek and switch weapons", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await player(context, "THUMBS", []);
  await page.goto("/game?map=district");
  await expect(page.locator(".dd-tc-look")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".dd-root")).toHaveClass(/dd-touch/);
  for (const id of ["fire", "fireL", "aim", "jump", "crouch", "peekL", "peekR"]) {
    await expect(page.locator(`[data-id="${id}"]`)).toBeVisible();
  }
  const cdp = await context.newCDPSession(page);
  const ammo = page.locator(".dd-hud .ammo b");
  await expect(ammo).toHaveText("35");

  await test.step("drag on the right half turns the view", async () => {
    const before = await frame(page);
    await touch(cdp, "touchStart", [{ x: 520, y: 120, id: 1 }]);
    for (let i = 1; i <= 8; i++) await touch(cdp, "touchMove", [{ x: 520 + i * 15, y: 120, id: 1 }]);
    await touch(cdp, "touchEnd", []);
    expect(Buffer.compare(before, await frame(page))).not.toBe(0);
  });

  await test.step("hold FIRE while the stick is pushed: two fingers at once, and the magazine empties", async () => {
    const fire = await centre(page, '[data-id="fire"]');
    await touch(cdp, "touchStart", [{ x: 140, y: 300, id: 2 }]);
    await touch(cdp, "touchMove", [{ x: 140, y: 260, id: 2 }]);
    await touch(cdp, "touchStart", [
      { x: 140, y: 260, id: 2 },
      { ...fire, id: 3 },
    ]);
    await expect.poll(async () => Number(await ammo.textContent()), { timeout: 5000 }).toBeLessThan(30);
    await touch(cdp, "touchEnd", []);
    const left = Number(await ammo.textContent());
    await page.waitForTimeout(400);
    expect(Number(await ammo.textContent()), "fire stops when the finger lifts").toBe(left);
  });

  await test.step("PEEK leans the view out and opens the scope while held", async () => {
    const peek = await centre(page, '[data-id="peekR"]');
    const before = await frame(page);
    await touch(cdp, "touchStart", [{ ...peek, id: 4 }]);
    await expect(page.locator(".dd-aim.on")).toHaveCount(1);
    expect(Buffer.compare(before, await frame(page))).not.toBe(0);
    await touch(cdp, "touchEnd", []);
    await expect(page.locator(".dd-aim.on")).toHaveCount(0);
  });

  await test.step("the weapon strip switches guns", async () => {
    const slot = await centre(page, '.dd-tc-slot:has-text("M1887")');
    await touch(cdp, "touchStart", [{ ...slot, id: 5 }]);
    await touch(cdp, "touchEnd", []);
    await expect(page.locator(".dd-hud .weapon")).toHaveText("M1887");
  });

  await test.step("dragging the stick up past the rim locks a run; a tap ends it", async () => {
    await touch(cdp, "touchStart", [{ x: 150, y: 340, id: 6 }]);
    for (let i = 1; i <= 8; i++) await touch(cdp, "touchMove", [{ x: 150, y: 340 - i * 16, id: 6 }]);
    await touch(cdp, "touchEnd", []);
    const lock = page.locator(".dd-tc-sprintlock");
    await expect(lock).toBeVisible();
    const at = await centre(page, ".dd-tc-sprintlock");
    await touch(cdp, "touchStart", [{ ...at, id: 7 }]);
    await touch(cdp, "touchEnd", []);
    await expect(lock).toHaveCount(0);
  });

  await test.step("the gear pauses and opens touch settings; a preset sticks", async () => {
    const gear = await centre(page, '[aria-label="touch settings"]');
    await touch(cdp, "touchStart", [{ ...gear, id: 8 }]);
    await touch(cdp, "touchEnd", []);
    await expect(page.locator(".dd-tc-settings h1")).toHaveText("TOUCH CONTROLS");
    await page.locator(".dd-tc-settings select").last().selectOption("claw4");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("dd_touch") ?? "{}").preset)).toBe("claw4");
  });

  await context.close();
});

test("a phone held upright is asked to turn sideways", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await player(context, "UPRIGHT", []);
  await page.goto("/game?map=district");
  await expect(page.locator(".dd-rotate")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".dd-rotate")).toContainText("turn your phone sideways");
  await context.close();
});

test("a desktop keeps the mouse and keyboard: no touch controls, and C / V peek", async ({ page }) => {
  await page.goto("/game?map=district");
  await expect(page.locator(".dd-stage canvas")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator(".dd-area")).not.toBeEmpty({ timeout: 60_000 });
  await expect(page.locator(".dd-touch-layer")).toHaveCount(0);
  // hold V: the view leans right; let go and it comes back
  await page.waitForTimeout(500);
  const still = await frame(page);
  await page.keyboard.down("KeyV");
  await page.waitForTimeout(500);
  const leaned = await frame(page);
  await page.keyboard.up("KeyV");
  expect(Buffer.compare(still, leaned), "the view moved while V was held").not.toBe(0);
});
