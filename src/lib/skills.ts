// Skills live under the hidden .vault/skills/ namespace — managed through
// the Skills view, invoked with slash commands, still readable/editable by
// the assistant through its vault tools.

import { parseFrontmatter, serializeFrontmatter } from '../../shared/frontmatter.mjs';
import { putRecord } from './sync';
import type { VaultRecord } from './types';

export interface Skill {
  path: string;
  name: string;
  trigger: string;
  description: string;
  instructions: string;
}

export function listSkills(records: Map<string, VaultRecord>): Skill[] {
  const skills: Skill[] = [];
  for (const rec of records.values()) {
    if (rec.type !== 'file' || !rec.path.endsWith('.md')) continue;
    if (!rec.path.startsWith('.vault/skills/') && !rec.path.startsWith('skills/')) continue;
    const { data, body } = parseFrontmatter(rec.content);
    skills.push({
      path: rec.path,
      name: String(data.name || rec.path.split('/').pop()!.replace(/\.md$/, '')),
      trigger: String(data.trigger || ''),
      description: String(data.description || ''),
      instructions: body.trim(),
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveSkill(skill: Skill): Promise<void> {
  await putRecord(
    skill.path,
    'file',
    serializeFrontmatter(
      { name: skill.name, trigger: skill.trigger, description: skill.description },
      skill.instructions.trim() + '\n'
    )
  );
}

export function newSkillPath(records: Map<string, VaultRecord>): string {
  let n = 1;
  while (records.has(`.vault/skills/new-skill-${n}.md`)) n++;
  return `.vault/skills/new-skill-${n}.md`;
}
