const fs = require("node:fs");
const path = require("node:path");
const { validatePublicConfig } = require("../contracts.cjs");
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../config.production.json"), "utf8"));
validatePublicConfig(config);
console.log("Desktop public configuration validated.");
