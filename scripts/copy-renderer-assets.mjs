import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const pairs = [
  ["src/renderer/index.html", "dist/renderer/index.html"],
  ["src/renderer/styles.css", "dist/renderer/styles.css"],
  ["src/renderer/assets/unityhub.png", "dist/renderer/assets/unityhub.png"],
  ["src/renderer/assets/cloud.svg", "dist/renderer/assets/cloud.svg"],
];

for (const [, to] of pairs) {
  mkdirSync(path.dirname(to), { recursive: true });
}

for (const [from, to] of pairs) {
  copyFileSync(from, to);
}
