#!/usr/bin/env node
// Update package.json and package-lock.json with the current git tag version
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

// Get the latest git tag and sanitize it for npm
function getVersion() {
  try {
    const tag = execSync("git describe --tags --abbrev=0", {
      stdio: ["pipe", "pipe", "ignore"],
    })
      .toString()
      .trim();
    // Remove leading 'v' and any suffix like '-beta1'
    return tag.replace(/^v/, "").replace(/-.*/, "");
  } catch (e) {
    // No tag found; keep existing version
    return null;
  }
}

// Write the version to a given JSON file
function writeVersion(file, version) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.version = version;
  if (data.packages && data.packages[""]) {
    data.packages[""].version = version;
  }
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

const version = getVersion();
if (version) {
  writeVersion("package.json", version);
  writeVersion("package-lock.json", version);
}
