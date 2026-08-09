import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Las de `integration` necesitan un Postgres de verdad y se saltan solas
    // si no hay `TEST_DATABASE_URL` (ver tests/integration/_db.ts).
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    // Comparten tablas: en paralelo se pisarían entre archivos.
    fileParallelism: false,
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
