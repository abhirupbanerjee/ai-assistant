/**
 * Core Skills Seeder
 *
 * Seeds the initial core skills from config files.
 * Skills are defined in config/skills.json (manifest) and config/skills/*.md (prompts).
 * These skills are marked as is_core=true and cannot be deleted.
 */

import { seedCoreSkill } from '../db/compat/skills';
import { loadSkillsFromConfig } from '../config-loader';
import type { TriggerType } from './types';

/**
 * Seed core skills into the database from config files
 * This is idempotent - skills are only created if they don't exist
 */
export async function seedCoreSkills(): Promise<void> {
  console.log('[Skills] Seeding core skills from config...');

  const skills = loadSkillsFromConfig();

  if (skills.length === 0) {
    console.log('[Skills] No skills found in config. Skipping seed.');
    return;
  }

  for (const skill of skills) {
    await seedCoreSkill(
      skill.name,
      skill.description,
      skill.promptContent,
      skill.triggerType as TriggerType,
      skill.triggerValue,
      skill.priority
    );
  }

  console.log(`[Skills] Seeded ${skills.length} core skills from config`);
}
