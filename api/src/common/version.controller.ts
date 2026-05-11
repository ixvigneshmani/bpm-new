import { Controller, Get } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_VERSION = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "..", "package.json"), "utf8"),
    );
    return pkg.version as string;
  } catch {
    return "unknown";
  }
})();

@Controller("version")
export class VersionController {
  @Get()
  get() {
    return {
      version: PACKAGE_VERSION,
      gitSha: process.env.BUILD_SHA ?? "dev",
      buildTime: process.env.BUILD_TIME ?? null,
      nodeEnv: process.env.NODE_ENV ?? "development",
    };
  }
}
