---
description: A second opinion on your current changes from Gemini and GPT-5.1 through FOTOhub
argument-hint: "Optional focus, e.g. \"security\" or \"the caching logic\""
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git log:*)
---

Get a second opinion on the uncommitted changes in this repository. Focus: $ARGUMENTS

1. Collect the change: `git status --short` and `git diff HEAD` (stat first; if the diff is over about 60 KB, keep the files most relevant to the focus and say what you left out).
2. Write one review prompt: what the change is for (from the diff and recent commits), the diff itself, and the focus. Ask for concrete defects only (bugs, security problems, broken edge cases), each with the file and line, ranked by severity, and no style comments.
3. Call `fotohub_compare_models` with `gemini-pro` and `gpt-4o`.
4. Check every finding against the code yourself. Report the ones that hold up, merged and ranked, and list the ones you rejected with a one-line reason. End with the cost.

Do not change any files unless I ask you to.
