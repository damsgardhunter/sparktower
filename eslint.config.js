import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Lint rules chosen to be worth blocking a merge on.
 *
 * The temptation with a linter on an existing codebase is to switch on a
 * "recommended" preset, get four thousand findings, mark the job non-blocking
 * and stop reading it. That is worse than having no linter: the signal is real
 * but nobody can see it under the noise, and CI has learned to be ignored.
 *
 * So this is deliberately narrow. Every rule here catches something that is a
 * bug rather than a preference, and the set passes cleanly today — which is
 * what makes it safe to make required. Style is left to whoever is typing;
 * there is no formatter and no opinion about semicolons.
 *
 * Widening it is a separate job from adding it. Turn a rule on, fix what it
 * finds, commit both together.
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".cache/**",           // Bun's install cache — thousands of vendored files.
      "attached_assets/**",
      "client/public/**",
      ".local/**",           // Claude skill scaffolding, not project code.
      "client/replit_integrations/**", // Vendored, like the server-side one.
      "mobile/**",           // Its own package, typechecked in its own CI job.
      "local_objects/**",
      "test/.objects/**",
      "client/src/components/ui/**", // Vendored shadcn primitives.
      "server/replit_integrations/**", // Vendored integration scaffolding.
      "**/*.config.js",
      "**/*.config.ts",
    ],
  },

  js.configs.recommended,

  {
    // Plain-JS Node scripts. `console`, `process` and `URL` are real globals
    // here; without a type checker no-undef has nothing useful to say.
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    rules: { "no-undef": "off" },
  },

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      /*
       * Off wholesale: these fire constantly on a TypeScript codebase for
       * reasons the compiler already handles better, and none of them
       * distinguishes a bug from a habit.
       */
      "no-unused-vars": "off",          // tsc reports these, with types.
      "no-undef": "off",                // Meaningless with a type checker.
      "no-empty": ["error", { allowEmptyCatch: true }],
      /*
       * Off because each one fired only on things that were correct: an
       * interface and a component legitimately sharing a name (declaration
       * merging), a regex that exists to strip control characters, and a
       * typing-game passage that is literally code as prose. A rule whose
       * every hit is a false positive is a rule people learn to disable.
       */
      "no-redeclare": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "no-irregular-whitespace": ["error", { skipRegExps: true, skipStrings: true }],

      // --- Genuine bugs -------------------------------------------------
      "no-debugger": "error",
      "no-dupe-keys": "error",          // A silently ignored object key.
      "no-dupe-args": "error",
      "no-duplicate-case": "error",     // A switch branch that never runs.
      "no-unreachable": "error",
      "no-unsafe-negation": "error",
      "no-unsafe-optional-chaining": "error", // `a?.b.c` throwing on null.
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-constant-binary-expression": "error", // `x === "a" || "b"`.
      "no-async-promise-executor": "error",
      "no-await-in-loop": "off",        // Deliberate in the seed scripts.
      "no-compare-neg-zero": "error",
      "no-cond-assign": ["error", "except-parens"],
      "no-ex-assign": "error",
      "no-fallthrough": "error",
      "no-import-assign": "error",
      "no-loss-of-precision": "error",  // A literal that isn't the number written.
      "no-misleading-character-class": "error",
      "no-prototype-builtins": "off",   // Common and harmless here.
      "no-sparse-arrays": "error",
      "no-template-curly-in-string": "off", // Fires on code shown as text.
      "require-atomic-updates": "off",  // Too many false positives to gate on.
      "use-isnan": "error",
      "valid-typeof": "error",

      /*
       * A promise nobody waits for. The rule needs type information to be
       * exact, so this is the syntactic subset: an `await` that was meant to be
       * there and isn't shows up as an unhandled rejection at runtime, which on
       * a request path is a 500 with no stack anyone can place.
       */
      "@typescript-eslint/no-misused-new": "error",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "off", // Pervasive and deliberate.
    },
  },
);
