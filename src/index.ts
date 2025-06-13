#!/usr/bin/env node

import { getLogOutput } from "./jjUtils";

async function main() {
  console.log("jj-spice is running!");
  console.log("Fetching jj log output...");

  try {
    const logOutput = await getLogOutput();
    console.log(logOutput);
  } catch (error) {
    console.error("Failed to get jj log output:", error);
  }
}

void main();
