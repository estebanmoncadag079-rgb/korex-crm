import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "drizzle/**",
      "scripts/**",
      "next-env.d.ts",
      // Los bundles que dejan los scripts de `package.json` al ejecutarse. Se
      // ignoraban de uno en uno por nombre, así que cada script nuevo rompía el
      // lint la primera vez que se corría.
      ".tmp-*.mjs",
      // Se sirve tal cual, sin pasar por el compilador. Ahí aterriza el worker
      // de pdf.js que copia `prebuild`: 1,2 MB minificados que disparaban 1.576
      // avisos sobre código que no es nuestro.
      "public/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
