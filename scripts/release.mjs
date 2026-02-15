import { execSync } from "node:child_process";

function run(command) {
  execSync(command, { stdio: "inherit" });
}

const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump)) {
  console.error("Usage: node scripts/release.mjs <patch|minor|major>");
  process.exit(1);
}

run("git diff --quiet");
run("git diff --cached --quiet");

run(`npm version ${bump} --tag-version-prefix=`);
const version = execSync("npm pkg get version", { encoding: "utf-8" }).trim().replaceAll("\"", "");

run("git push --follow-tags");
run(`gh release create ${version} --title ${version} --generate-notes`);
