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
    // Assert the invariant, not the duration (BUG-057).
    //
    // A test that measures elapsed wall clock is measuring the host as much as
    // the code. On a machine running several agent worktrees at once the host
    // loses, so these assertions failed on load and passed on rerun, and the
    // regressions they existed to catch were lost in that noise. The selectors
    // below match the one shape that means "how long did this take": a clock
    // read minus an earlier reading held in a variable, or a high-resolution
    // timer, inside a test. `Date.now() - 5 * 60_000` and other fixture
    // timestamps subtract a literal, so they are untouched, as are
    // animation-frame arguments.
    //
    // `electron/main/cost.test-support.ts` is the replacement: transient
    // allocation carries the same signal about work per unit of input and does
    // not move with CPU contention.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.test.mjs'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'BinaryExpression[operator="-"][left.callee.property.name="now"][right.type="Identifier"]',
          message:
            'Elapsed wall clock measures the host, not the code, and fails under concurrent agent worktrees. Assert the algorithmic invariant instead — see transientAllocation in electron/main/cost.test-support.ts (BUG-057).',
        },
        {
          selector:
            'CallExpression[callee.object.object.name="process"][callee.object.property.name="hrtime"], CallExpression[callee.object.name="process"][callee.property.name="hrtime"]',
          message:
            'A high-resolution timer in a test is a duration budget, and duration budgets fail on host load. Assert the algorithmic invariant instead — see transientAllocation in electron/main/cost.test-support.ts (BUG-057).',
        },
      ],
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
      // Composed company output is a COPY of files linted at their real path.
      ".company-build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
