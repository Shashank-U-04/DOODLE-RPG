// The three-screen flow for PLAY WITH FRIENDS: title → setup (map and kills to
// win) → room. The kill target picked on the setup screen is the room's: the
// guest's lobby and both HUDs show it, the server wins the match on it, and
// the room itself never offers a map.
import { expect, test } from "./fixtures";
import { finishMatch, GUEST, HOST, overlay, player } from "./helpers";

test("the host's kill target on the setup screen runs the match; the room picks no map", async ({
  browser,
  request,
}) => {
  const offHost: string[] = [];
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await player(hostContext, HOST, offHost);
  const guest = await player(guestContext, GUEST, offHost);

  await test.step("setup: pick the pyramid and first to 5, then create the room", async () => {
    await host.goto("/");
    await host.getByRole("button", { name: /PLAY WITH FRIENDS/ }).click();
    await expect(host).toHaveURL(/\/setup\?.*mode=friends/);
    await host.getByRole("button", { name: /THE GREAT PYRAMID/ }).click();
    const kills = host.getByRole("group", { name: "kills to win" });
    await expect(kills.getByRole("button", { name: "15", exact: true })).toHaveAttribute("aria-pressed", "true");
    await kills.getByRole("button", { name: "5", exact: true }).click();
    await expect(kills.getByRole("button", { name: "5", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(host).toHaveURL(/kills=5/);
    await host.locator(".dd-netform input").first().fill(HOST);
    await host.getByRole("button", { name: /CREATE ROOM/ }).click();
    await expect(host.locator(".dd-netcode")).toHaveText(/^[A-Z0-9]{4}$/, { timeout: 20_000 });
  });
  const code = (await host.locator(".dd-netcode").textContent())!.trim();

  await test.step("the room shows the rules and offers no map to pick", async () => {
    // a guest who never saw the setup screen still gets the host's rules
    await guest.goto(`/online?room=${code}`);
    for (const page of [host, guest]) {
      await expect(page.locator(".dd-roster")).toContainText("IN THE ROOM (2) · up to 10", { timeout: 20_000 });
      await expect(page.locator(".dd-screen")).toContainText("first to 5 kills wins");
      await expect(page.locator(".mapgrid")).toHaveCount(0);
    }
    await expect(host.locator(".dd-screen h2").first()).toHaveText("the great pyramid");
    await expect(guest.locator(".dd-screen h2").first()).toHaveText("the great pyramid");
  });

  await test.step("both HUDs count to 5, and the server ends it at 5", async () => {
    await guest.getByRole("button", { name: /I'M READY/ }).click();
    await host.getByRole("button", { name: /ENTER ARENA/ }).click();
    for (const page of [host, guest]) {
      await expect(page.locator(".dd-hud-tl .score")).toHaveText("KILLS 0 / 5", { timeout: 30_000 });
    }
    await finishMatch(request, code, HOST);
    await expect(overlay(host).locator("h1")).toHaveText("YOU WIN");
    await expect(overlay(guest).locator("h2")).toHaveText(`${HOST} took it · 5 kills`);
    await expect(host.locator(".dd-hud-tl .score")).toHaveText("KILLS 5 / 5");
  });

  await hostContext.close();
  await guestContext.close();
});
