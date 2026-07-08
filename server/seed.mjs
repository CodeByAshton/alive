// First-run vault contents: a few linked notes and the starter skills.
// Skills are ordinary vault files the user can open and edit.

export function seedVault(store) {
  if (store.list().length > 0) return;

  const put = (path, content) => store.put({ path, type: 'file', content });

  put(
    '.vault/AGENT.md',
    `# AGENT.md

Standing instructions for the assistant. This file is loaded into every turn — edit it to shape how the assistant behaves in this vault (like a CLAUDE.md).

- Prefer short, direct answers.
- New notes go under notes/ unless told otherwise; journals under journal/.
- When you change the vault, mention what changed in one line.
- Personal context lives in [[context]] — check it before making assumptions.
`
  );

  put(
    'context/About Me.md',
    `# About Me

Fill this in — the assistant reads files you reference with [[wikilinks]] or @paths, and this folder is the conventional home for standing personal context.

- Name:
- What I'm working on:
- Preferences:
`
  );

  put(
    'Welcome.md',
    `# Welcome to Vault

Everything here is a Markdown file in a folder tree — including your chats with the assistant, which live under [[chats]] as folders of message files.

- Notes link to each other with [[wikilinks]] — try [[Ideas]] or [[Reading List]].
- The graph view (right rail) shows notes as nodes and links as edges.
- Type a message in a chat and the assistant can read and edit this same vault.
- Skills live in the skills/ folder — invoke one with a slash command like \`/summarize\`.
`
  );

  put(
    'notes/Ideas.md',
    `# Ideas

A scratchpad of things worth building.

- A reading queue that syncs with [[Reading List]]
- Weekly review ritual — see [[Weekly Review]]
`
  );

  put(
    'notes/Reading List.md',
    `# Reading List

- *The Mythical Man-Month*
- *Thinking in Systems*

Related: [[Ideas]]
`
  );

  put(
    'notes/Weekly Review.md',
    `# Weekly Review

Every Sunday: review [[Ideas]], prune the [[Reading List]], plan the week.
`
  );

  put(
    '.vault/skills/summarize.md',
    `---
name: Summarize
trigger: /summarize
description: Summarize a note or the recent conversation into crisp bullet points.
---

Summarize the subject the user points at (a note path, a [[wikilink]], or the recent conversation if unspecified). Read the note first if one is referenced. Produce 3-7 tight bullet points capturing only the essential content, then one line of suggested next action. If editing tools are available and the user asks to save the summary, write it to a new note next to the source.
`
  );

  put(
    '.vault/skills/journal.md',
    `---
name: Journal
trigger: /journal
description: Append a dated journal entry to journal/<year>.md.
---

Take the user's text after the command as a journal entry. If writing tools are available, append it under a "## <today's date>" heading in journal/<current year>.md (create the file if needed), then confirm in one sentence. If writing tools are not available, reflect the entry back, offer one sentence of reflection, and remember it for later.
`
  );

  put(
    '.vault/skills/task.md',
    `---
name: Task
trigger: /task
description: Capture a task into Tasks.md.
---

Capture the text after the command as a task. If writing tools are available, append "- [ ] <task>" to Tasks.md (create it if needed) and confirm briefly. Otherwise acknowledge the task conversationally and keep it in mind for the conversation.
`
  );

  store.put({ path: 'chats', type: 'folder' });
}

// Move pre-.vault layouts into the hidden system namespace.
export function migrateVault(store) {
  if (store.get('AGENT.md') && !store.get('.vault/AGENT.md')) {
    store.move('AGENT.md', '.vault/AGENT.md');
  }
  const legacySkills = store.list('skills').filter((r) => r.type === 'file');
  if (legacySkills.length && !store.list('.vault/skills').length) {
    store.move('skills', '.vault/skills');
  }
}
