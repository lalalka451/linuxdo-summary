#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const userScriptPath = path.join(rootDir, "linuxdo_summary.user.js");
const metaScriptPath = path.join(rootDir, "linuxdo_summary.meta.js");

const expectedDownloadURL =
  "https://cdn.jsdelivr.net/gh/lalalka451/linuxdo-summary@latest/linuxdo_summary.user.js";
const expectedUpdateURL =
  "https://cdn.jsdelivr.net/gh/lalalka451/linuxdo-summary@latest/linuxdo_summary.meta.js";

const requestedVersion = process.argv[2];

const source = fs.readFileSync(userScriptPath, "utf8");
const newline = source.includes("\r\n") ? "\r\n" : "\n";
const trimmedSource = source.replace(/(?:\r?\n)+$/, "");
const lines = trimmedSource.split(/\r?\n/);

let sawVersion = false;
let sawDownloadURL = false;
let sawUpdateURL = false;
let metadataEndIndex = -1;

const updatedLines = lines.map((line, index) => {
  if (line === "// ==/UserScript==") {
    metadataEndIndex = index;
  }

  if (/^\/\/ @version\b/.test(line)) {
    sawVersion = true;
    if (requestedVersion) {
      return `// @version      ${requestedVersion}`;
    }
  }

  if (/^\/\/ @downloadURL\b/.test(line)) {
    sawDownloadURL = true;
    return `// @downloadURL ${expectedDownloadURL}`;
  }

  if (/^\/\/ @updateURL\b/.test(line)) {
    sawUpdateURL = true;
    return `// @updateURL   ${expectedUpdateURL}`;
  }

  return line;
});

if (metadataEndIndex === -1) {
  throw new Error("Metadata block end marker not found.");
}

if (!sawVersion || !sawDownloadURL || !sawUpdateURL) {
  throw new Error("Expected @version, @downloadURL, and @updateURL in metadata.");
}

const normalizedUserScript = `${updatedLines.join(newline)}${newline}`;
const metaScript = `${updatedLines.slice(0, metadataEndIndex + 1).join(newline)}${newline}`;
const versionLine = updatedLines.find((line) => /^\/\/ @version\b/.test(line));
const version = versionLine.replace(/^\/\/ @version\s+/, "");

fs.writeFileSync(userScriptPath, normalizedUserScript, "utf8");
fs.writeFileSync(metaScriptPath, metaScript, "utf8");

process.stdout.write(`Synced userscript metadata for ${version}.${newline}`);
