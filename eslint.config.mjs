import nextVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier";

const eslintConfig = [
  ...nextVitals,
  prettier,
  {
    rules: {
      // Keep the current codebase lintable while React Compiler-oriented rules
      // are evaluated separately from baseline correctness linting.
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".claude/worktrees/**",
      "**/.next/**",
      "out/**",
      "build/**",
      "dist/**",
      "dist-electron/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
