import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";

test.describe("Electron launcher UI", () => {
  test("Add menu opens and Add from disk dialog appears", async () => {
    const app = await electron.launch({ args: ["dist/app.js"] });
    try {
      const window = await app.firstWindow();
      await window.waitForSelector("#add-toggle");

      await window.click("#add-toggle");
      await expect(window.locator("#add-menu")).toBeVisible();

      await window.click("#add-disk");
      await expect(window.locator("#disk-dialog[open]")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("New Project opens local project dialog", async () => {
    const app = await electron.launch({ args: ["dist/app.js"] });
    try {
      const window = await app.firstWindow();
      await window.waitForSelector("#new-project");

      await window.click("#new-project");
      await expect(window.locator("#disk-dialog[open]")).toBeVisible();
      await expect(window.locator("#status")).toContainText("choose a local project folder");
    } finally {
      await app.close();
    }
  });

  test("Project menu opens settings tab and cancel closes add dialog", async () => {
    const app = await electron.launch({ args: ["dist/app.js"] });
    try {
      const window = await app.firstWindow();
      await window.waitForSelector("#projects-more-toggle");

      await window.click("#projects-more-toggle");
      await expect(window.locator("#projects-more-menu")).toBeVisible();

      await window.click("#projects-menu-settings");
      await expect(window.locator("#view-settings")).toHaveClass(/active/);

      await window.click("#tab-projects");
      await window.click("#new-project");
      await expect(window.locator("#disk-dialog[open]")).toBeVisible();
      await window.click("#disk-dialog menu button.btn");
      await expect(window.locator("#disk-dialog[open]")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});
