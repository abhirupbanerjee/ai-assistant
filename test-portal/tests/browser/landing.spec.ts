import { expect, test } from "@playwright/test";

test("landing page exposes independent portal sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Test workspaces and Agent Bots");
  await expect(page.getByRole("link", { name: "Sign in with Microsoft" })).toHaveAttribute("href", "/auth/login");
});
