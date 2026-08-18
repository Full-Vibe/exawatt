<!-- Generated for the public repository by the "public-document-set" recipe. -->
# Claude Notes

Read `AGENTS.md` first. It is the canonical instruction file for product canon, documentation contracts, architecture maintenance, and repo workflow.

- Never use git add -A because I may be working on the repo at the same time as you
- When something doesn't work as expected, diagnose the root cause before writing a fix. Don't patch around framework abstractions with lower-level escape hatches — if the framework has an idiomatic way to do something, use it. A workaround that bypasses the framework is a sign you don't yet understand the problem.
