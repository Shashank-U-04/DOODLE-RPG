// A 1v1 where the other player goes: the one left behind wins by walkover.
//
// A consented leave (LEAVE MATCH) ends the match at once. A dropped connection
// first shows "lost connection · waiting…" while the server holds the seat;
// when the hold runs out (shortened here by a test-only route) the match ends
// the same way.
import { expect, test } from "./fixtures";
import { E2E_SERVER } from "./env";
import { GUEST, HOST, intoArena, overlay, player } from "./helpers";

test("the opponent leaves a 1v1: the host wins by walkover and can keep the room open", async ({ browser }) => {
  const offHost: string[] = [];
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await player(hostContext, HOST, offHost);
  const guest = await player(guestContext, GUEST, offHost);
  const code = await intoArena(host, guest);

  // Escape releases a captured mouse and pauses; the PAUSED panel has LEAVE MATCH
  await guest.keyboard.press("Escape");
  await expect(overlay(guest).locator("h1")).toHaveText("PAUSED");
  await overlay(guest)
    .getByRole("button", { name: /LEAVE MATCH/ })
    .click();

  await expect(overlay(host).locator("h1")).toHaveText("YOU WIN", { timeout: 10_000 });
  await expect(overlay(host).locator("h2")).toHaveText("your opponent left the match · last doodle standing");
  await expect(host.locator(".dd-killfeed")).toContainText(`${GUEST} LEFT THE MATCH`);
  await expect(host.getByRole("button", { name: /REMATCH/ })).toContainText(`friends join with code ${code}`);

  await hostContext.close();
  await guestContext.close();
});

test("the opponent's connection drops: 'waiting' while the seat is held, then a walkover", async ({
  browser,
  request,
}) => {
  const offHost: string[] = [];
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await player(hostContext, HOST, offHost);
  const guest = await player(guestContext, GUEST, offHost);
  const code = await intoArena(host, guest);
  const hold = await request.post(`${E2E_SERVER}/__e2e/rooms/${code}/hold`, { data: { seconds: 4 } });
  expect(hold.status()).toBe(200);

  // gone without a goodbye, as a closed laptop or a dead network is
  await guestContext.close();

  await expect(host.locator(".dd-waiting")).toHaveText(`${GUEST} lost connection · waiting for them to come back…`, {
    timeout: 10_000,
  });
  await expect(overlay(host)).toHaveCount(0);
  await expect(overlay(host).locator("h1")).toHaveText("YOU WIN", { timeout: 15_000 });
  await expect(overlay(host).locator("h2")).toHaveText("your opponent left the match · last doodle standing");
  await expect(host.locator(".dd-waiting")).toHaveCount(0);

  await hostContext.close();
});
