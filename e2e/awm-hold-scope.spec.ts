// The AWM's hold-to-scope: the left button held looks down the scope without
// firing, and letting go takes the shot. Every other gun still fires on press.
import { expect, test } from "./fixtures";

test("AWM: hold the left button to scope in, let go to fire; the AK still fires on press", async ({ page }) => {
  await page.goto("/game?map=district");
  await expect(page.locator(".dd-stage canvas")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator(".dd-area")).not.toBeEmpty({ timeout: 60_000 });
  const weapon = page.locator(".dd-hud-br .weapon");
  const mag = page.locator(".dd-hud-bl .ammo b");
  const scoped = page.locator(".dd-aim.scope.on");
  await page.mouse.move(640, 360);

  await page.keyboard.press("Digit3");
  await expect(weapon).toHaveText("AWM");
  await expect(mag).toHaveText("5");
  await page.waitForTimeout(400); // the draw

  await page.mouse.down();
  await expect(scoped).toHaveCount(1);
  await page.waitForTimeout(500);
  await expect(mag).toHaveText("5"); // held: scoped, no shot yet
  await page.mouse.up();
  await expect(mag).toHaveText("4"); // let go: the shot
  await expect(scoped).toHaveCount(0);

  // the rifle is unchanged: a press fires straight away
  await page.keyboard.press("Digit1");
  await expect(weapon).toHaveText("AK-47");
  await page.waitForTimeout(400);
  const before = Number(await mag.textContent());
  await page.mouse.down();
  await expect.poll(async () => Number(await mag.textContent())).toBeLessThan(before);
  await page.mouse.up();
});
