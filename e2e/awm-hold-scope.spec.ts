// The AWM's hold-to-scope: the left button held looks down the scope without
// firing, and letting go takes the shot, but only once the scope has been up
// half a second (a quick tap waits for it) and the 1.4 s bolt has cycled (a
// shot let go too early waits for it). Every other gun still fires on press.
// Timeouts are generous: a CI runner draws far fewer frames, and game time
// runs slower than the wall clock there.
import { expect, test } from "./fixtures";

test("AWM: hold to scope, let go to fire (never instantly); the AK still fires on press", async ({ page }) => {
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

  // a quick tap: the scope comes up and the shot waits for it
  await page.mouse.down();
  await page.mouse.up();
  await expect(scoped).toHaveCount(1);
  await page.waitForTimeout(150);
  await expect(mag).toHaveText("5"); // not yet
  await expect(mag).toHaveText("4", { timeout: 8000 }); // once the scope is up
  await expect(scoped).toHaveCount(0, { timeout: 8000 });

  // held past the bolt: scoped, no shot; let go: the shot
  await page.waitForTimeout(2500);
  await page.mouse.down();
  await expect(scoped).toHaveCount(1);
  await page.waitForTimeout(700);
  await expect(mag).toHaveText("4"); // held: still no shot
  await page.mouse.up();
  await expect(mag).toHaveText("3", { timeout: 8000 });
  await expect(scoped).toHaveCount(0, { timeout: 8000 });

  // the bolt: a shot let go straight after waits for it, then goes
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await page.waitForTimeout(200);
  await expect(mag).toHaveText("3"); // the bolt is still cycling
  await expect(mag).toHaveText("2", { timeout: 8000 }); // and then it goes

  // the rifle is unchanged: a press fires straight away
  await page.keyboard.press("Digit1");
  await expect(weapon).toHaveText("AK-47");
  await page.waitForTimeout(400);
  const before = Number(await mag.textContent());
  await page.mouse.down();
  await expect.poll(async () => Number(await mag.textContent())).toBeLessThan(before);
  await page.mouse.up();
});
