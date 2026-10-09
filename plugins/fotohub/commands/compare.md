---
description: Ask several FOTOhub text models the same question and compare their answers
argument-hint: "Question, e.g. \"Which of these three headlines is strongest and why?\""
---

Compare FOTOhub text models on: $ARGUMENTS

1. Write one self-contained prompt with all the context the models need (they see no files).
2. Call `fotohub_compare_models` with `gemini-pro`, `gpt-4o` and `claude-sonnet-4.6`, unless the question names other models (`fotohub_models` lists them).
3. Present a short table: model, its answer in one line, cost. Then say where they agree, where they differ, and which answer you would take, with your reason.
4. End with the total cost.
