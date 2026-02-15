import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const rendererDist = path.join(root, "dist", "renderer");
const pagesOut = path.join(root, "pages-dist");
const mockApiSource = path.join(root, "scripts", "pages", "mock-launcher-api.js");

async function buildPages() {
  await rm(pagesOut, { recursive: true, force: true });
  await mkdir(pagesOut, { recursive: true });

  await cp(rendererDist, pagesOut, { recursive: true });
  await cp(mockApiSource, path.join(pagesOut, "mock-launcher-api.js"));

  const indexPath = path.join(pagesOut, "index.html");
  const html = await readFile(indexPath, "utf8");
  const patched = html.replace(
    '<script src="./renderer.js"></script>',
    '<script src="./mock-launcher-api.js"></script>\n  <script src="./renderer.js"></script>',
  );
  await writeFile(indexPath, patched, "utf8");
}

buildPages().catch((error) => {
  console.error(error);
  process.exit(1);
});
