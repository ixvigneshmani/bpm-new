import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

const env = process.env.NODE_ENV || "development";
config({ path: `.env.${env}` });

export default defineConfig({
  schema: "./src/database/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
