import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getBundledRegistrySnapshot,
  getBundledSkillRegistrySnapshot,
  validateSkillRegistry,
  type SkillRegistrySnapshot,
  type SkillToolRef,
} from './index.ts';

const validationNow = new Date('2026-06-21T10:31:00.000Z');

describe('skill registry validation', () => {
  it('validates the bundled skill registry and includes draft plus eval-ready skills', () => {
    const snapshot = getBundledSkillRegistrySnapshot();
    const result = validateBundledSnapshot(snapshot);

    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.ok(snapshot.skills.length >= 2);
    assert.ok(snapshot.skills.some((skill) => skill.status === 'draft'));
    assert.ok(snapshot.skills.some((skill) => skill.status === 'eval_ready'));
  });

  it('rejects production skills without gate results and owner approval', () => {
    const snapshot = mutableSkillSnapshot();
    const skill = snapshot.skills[0];
    assert.ok(skill, 'bundled registry should include a skill to mutate');

    skill.status = 'production';
    skill.lifecycle_status = 'production';
    skill.rollout_policy = {
      rollout_state: 'production',
      production_enabled: true,
      allowed_project_refs: ['project:devgateway'],
      allowed_principal_refs: ['principal:skill-registry-admin'],
    };
    skill.approval_policy = {
      approval_required: false,
      approval_ref: null,
      approver_ref: null,
      policy_ref: 'policy:track2.skill.production.v0.1',
    };
    skill.gate_result_refs = [];
    skill.eval_suite_refs = skill.eval_suite_refs.map((ref) => ({ ...ref, gate_result_ref: null }));

    const result = validateBundledSnapshot(snapshot);

    assert.equal(result.ok, false);
    assert.ok(
      result.issues.some((issue) => issue.code === 'production_gate' && issue.path.endsWith('.gate_result_refs')),
      JSON.stringify(result.issues, null, 2),
    );
    assert.ok(
      result.issues.some((issue) => issue.code === 'approval_required' && issue.path.endsWith('.approval_policy')),
      JSON.stringify(result.issues, null, 2),
    );
  });

  it('rejects skills that reference unknown model aliases', () => {
    const snapshot = mutableSkillSnapshot();
    const skill = snapshot.skills[0];
    assert.ok(skill, 'bundled registry should include a skill to mutate');
    skill.allowed_model_aliases = ['devgateway/unknown-model-alias'];

    const result = validateBundledSnapshot(snapshot);

    assert.equal(result.ok, false);
    assert.ok(
      result.issues.some((issue) => issue.code === 'model_alias' && issue.path.endsWith('.allowed_model_aliases[0]')),
      JSON.stringify(result.issues, null, 2),
    );
  });

  it('rejects skills that allow write or side-effect tools', () => {
    const snapshot = mutableSkillSnapshot();
    const skill = snapshot.skills[0];
    assert.ok(skill, 'bundled registry should include a skill to mutate');
    const writeTool: SkillToolRef = {
      tool_definition_id: 'track2.artifact.write',
      tool_version: '0.1.0',
      risk_tier: 'disallowed_write',
    };
    skill.allowed_tool_refs = [writeTool];
    skill.tool_bundles = [
      {
        bundle_id: 'tool-bundle:track2/mutated-write-tool',
        bundle_version: '0.1.0',
        tool_refs: [writeTool],
      },
    ];

    const result = validateBundledSnapshot(snapshot);

    assert.equal(result.ok, false);
    assert.ok(
      result.issues.some((issue) => issue.code === 'tool_ref' && /write|side-effect|read-only/u.test(issue.message)),
      JSON.stringify(result.issues, null, 2),
    );
  });

  it('rejects raw prompt, content, secret, provider key, and token fields', () => {
    for (const [field, value] of [
      ['prompt', 'inline instructions should be stored by opaque ref only'],
      ['content', 'raw content should be stored by opaque ref only'],
      ['secret', 'sk-testsecretmaterial123456'],
      ['provider_key', 'provider-key-test-value'],
      ['token', 'bearer abcdefghijklmnopqrstuvwxyz123456'],
    ] as const) {
      const snapshot = mutableSkillSnapshot();
      const skill = snapshot.skills[0] as unknown as Record<string, unknown> | undefined;
      assert.ok(skill, 'bundled registry should include a skill to mutate');
      skill[field] = value;

      const result = validateBundledSnapshot(snapshot);

      assert.equal(result.ok, false, `${field} unexpectedly passed validation`);
      assert.ok(
        result.issues.some((issue) => issue.code === 'content_safety' && issue.path.endsWith(`.${field}`)),
        JSON.stringify(result.issues, null, 2),
      );
    }
  });
});

function validateBundledSnapshot(snapshot: SkillRegistrySnapshot) {
  return validateSkillRegistry({
    snapshot,
    modelRegistry: getBundledRegistrySnapshot(),
    now: validationNow,
  });
}

function mutableSkillSnapshot(): SkillRegistrySnapshot {
  return JSON.parse(JSON.stringify(getBundledSkillRegistrySnapshot())) as SkillRegistrySnapshot;
}
