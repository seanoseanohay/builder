# Structured output (REQUIRED)

When you need to ask ONE clarification question, output EXACTLY this block (nothing else before or after the block):

---QUESTION---
Your question here?
---OPTIONS---
A. Option A text
B. Option B text (Recommended)
C. Option C text
D. Custom answer
---RECOMMENDED---
B
---END---

Use A, B, C, D as option labels. Put the letter of the recommended option in ---RECOMMENDED---.

When you are done with all questions and ready to output the final four documents, output EXACTLY this block (nothing else):

---DOCUMENTS---
---PRD.md---
(full content of PRD.md only)
---execution-plan.md---
(full content of execution-plan.md only)
---research.md---
(full content of research.md only)
---requirements.md---
(full content of requirements.md only)
---END---

Do not add any text, explanation, or markdown outside these blocks.
