import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";

test.describe("Electron launcher UI", () => {
  async function getBoxOrThrow(window: import("@playwright/test").Page, selector: string) {
    const locator = window.locator(selector);
    const box = await locator.boundingBox();
    if (!box) {
      throw new Error(`Expected visible element for selector: ${selector}`);
    }
    return box;
  }

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

  test("Projects and Unity Installs tabs keep title and table aligned", async () => {
    const app = await electron.launch({ args: ["dist/app.js"] });
    try {
      const window = await app.firstWindow();
      await window.waitForSelector("#view-projects.active");

      const projectsTitleBox = await getBoxOrThrow(window, "#view-projects .toolbar h1");
      const projectsTableBox = await getBoxOrThrow(window, "#view-projects .projects-panel");

      await expect(Math.abs(projectsTitleBox.x - projectsTableBox.x)).toBeLessThanOrEqual(2);

      await window.click("#tab-installs");
      await window.waitForSelector("#view-installs.active");

      const installsTitleBox = await getBoxOrThrow(window, "#view-installs .toolbar h1");
      const installsTableBox = await getBoxOrThrow(window, "#view-installs .projects-panel");

      await expect(Math.abs(installsTitleBox.x - installsTableBox.x)).toBeLessThanOrEqual(2);
      await expect(Math.abs(projectsTableBox.x - installsTableBox.x)).toBeLessThanOrEqual(2);
    } finally {
      await app.close();
    }
  });
});
