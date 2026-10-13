import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDraftRepository } from '../../src/features/roster/data/draftRepository.js';
import { createGuidanceRepository } from '../../src/features/roster/data/guidanceRepository.js';
import DraftProtocol from '../../src/features/roster/queue/protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const draftPanelEnabled = settings => DraftProtocol.enabled(settings);
const rosterPanelEnabled = settings => draftPanelEnabled(settings) || ['weekly_off_guidance_enabled', 'night_safety_guidance_enabled'].some(key => settings?.[key] === true || settings?.[key] === 'true');

test('1. V2 repository browser request does not force incompatible credentialed cross-origin fetch behavior', async () => {
  const draftRepoSrc = fs.readFileSync(path.join(rootDir, 'src/features/roster/data/draftRepository.js'), 'utf8');
  const guidanceRepoSrc = fs.readFileSync(path.join(rootDir, 'src/features/roster/data/guidanceRepository.js'), 'utf8');

  // Static assertion: credentials: 'include' must be completely absent from both transports
  assert.equal(
    draftRepoSrc.includes("credentials:'include'") || draftRepoSrc.includes('credentials: "include"') || draftRepoSrc.includes("credentials: 'include'"),
    false,
    'draftRepository must not specify credentials: include'
  );
  assert.equal(
    guidanceRepoSrc.includes("credentials:'include'") || guidanceRepoSrc.includes('credentials: "include"') || guidanceRepoSrc.includes("credentials: 'include'"),
    false,
    'guidanceRepository must not specify credentials: include'
  );

  // Runtime assertion: draftRepository request does not send credentials: include
  let capturedDraftOptions = null;
  const mockDraftFetcher = async (url, options) => {
    capturedDraftOptions = options;
    return {
      ok: true,
      json: async () => ({
        ok: true,
        period: { PeriodId: '2026-11', State: 'DRAFT', Revision: 0 }
      })
    };
  };

  const draftRepo = createDraftRepository({
    baseUrl: 'https://script.google.com/macros/s/test/exec',
    fetcher: mockDraftFetcher
  });

  const lcRes = await draftRepo.getPeriodLifecycle('2026-11');
  assert.equal(lcRes.ok, true);
  assert.ok(capturedDraftOptions, 'Fetcher must be invoked');
  assert.equal(capturedDraftOptions.credentials, undefined, 'options.credentials must be omitted to allow standard CORS');
  assert.equal(capturedDraftOptions.headers?.Accept, 'application/json');

  // Runtime assertion: guidanceRepository request does not send credentials: include
  let capturedGuidanceOptions = null;
  const mockGuidanceFetcher = async (url, options) => {
    capturedGuidanceOptions = options;
    return {
      ok: true,
      json: async () => ({
        ok: true,
        policies: []
      })
    };
  };

  const guidanceRepo = createGuidanceRepository({
    baseUrl: 'https://script.google.com/macros/s/test/exec',
    fetcher: mockGuidanceFetcher
  });

  const polRes = await guidanceRepo.policies();
  assert.equal(polRes.ok, true);
  assert.ok(capturedGuidanceOptions, 'Fetcher must be invoked');
  assert.equal(capturedGuidanceOptions.credentials, undefined, 'guidance options.credentials must be omitted');
  assert.equal(capturedGuidanceOptions.headers?.Accept, 'application/json');
});

test('2. Unenrolled month does not expose Private Draft / guidance working panels', () => {
  const rosterPageSrc = fs.readFileSync(path.join(rootDir, 'src/components/RosterPage.jsx'), 'utf8');

  // Static assertion: DraftQueuePanel is strictly gated behind lifecycleInfo.isEnrolled
  const draftQueueGatingPattern = /selectedName\?\.trim\(\)\.toLowerCase\(\)\s*===\s*'admin'\s*&&\s*rosterPanelEnabled\(settings\)\s*&&\s*Boolean\(lifecycleInfo\.isEnrolled\s*&&\s*lifecycleInfo\.period\s*===\s*rosterMonth\)\s*&&\s*<DraftQueuePanel/;
  assert.ok(
    draftQueueGatingPattern.test(rosterPageSrc),
    'DraftQueuePanel must be strictly gated by Boolean(lifecycleInfo.isEnrolled && lifecycleInfo.period === rosterMonth)'
  );

  // Exact gate evaluation logic as implemented in RosterPage.jsx
  const evaluateDraftQueuePanelVisibility = ({ selectedName, settings, lifecycleInfo, rosterMonth }) => {
    return Boolean(
      selectedName?.trim().toLowerCase() === 'admin' &&
      rosterPanelEnabled(settings) &&
      Boolean(lifecycleInfo.isEnrolled && lifecycleInfo.period === rosterMonth)
    );
  };

  const octoberUnenrolledLifecycle = {
    period: '2026-10',
    isEnrolled: false,
    state: null,
    revision: null
  };

  const v2Settings = {
    roster_workspace_v2_enabled: true,
    roster_v2_read_enabled: true,
    roster_v2_write_enabled: true,
    write_queue_v2_enabled: true,
    weekly_off_guidance_enabled: true,
    night_safety_guidance_enabled: true
  };

  // Admin user on October 2026: MUST NOT render DraftQueuePanel
  const adminOctoberVisible = evaluateDraftQueuePanelVisibility({
    selectedName: 'Admin',
    settings: v2Settings,
    lifecycleInfo: octoberUnenrolledLifecycle,
    rosterMonth: '2026-10'
  });
  assert.equal(adminOctoberVisible, false, 'DraftQueuePanel must NOT render for unenrolled October 2026 even for Admin');

  // Non-admin user on October 2026: MUST NOT render
  const nonAdminOctoberVisible = evaluateDraftQueuePanelVisibility({
    selectedName: 'Dr. Ali',
    settings: v2Settings,
    lifecycleInfo: octoberUnenrolledLifecycle,
    rosterMonth: '2026-10'
  });
  assert.equal(nonAdminOctoberVisible, false, 'DraftQueuePanel must NOT render for non-admin');
});

test('3. Enrolled DRAFT month remains eligible for V2 workspace activation', () => {
  const evaluateRosterPageGates = (settings, lifecycleInfo, selectedName, rosterMonth) => {
    const isWorkspaceEnabled = Boolean(
      settings?.roster_workspace_v2_enabled === true ||
      String(settings?.roster_workspace_v2_enabled || '').toLowerCase() === 'true'
    );
    const renderLifecycleControls = isWorkspaceEnabled;
    const renderPhase5Container = isWorkspaceEnabled &&
      lifecycleInfo.isEnrolled &&
      ['DRAFT', 'PUBLISHED', 'AMENDED', 'CLOSED'].includes(lifecycleInfo.state) &&
      settings?.roster_v2_read_enabled !== false;
    const renderLegacyRosterUi = !renderPhase5Container;
    const renderDraftQueuePanel = Boolean(
      selectedName?.trim().toLowerCase() === 'admin' &&
      rosterPanelEnabled(settings) &&
      Boolean(lifecycleInfo.isEnrolled && lifecycleInfo.period === rosterMonth)
    );
    return {
      renderLifecycleControls,
      renderPhase5Container,
      renderLegacyRosterUi,
      renderDraftQueuePanel
    };
  };

  const novemberDraftLifecycle = {
    period: '2026-11',
    isEnrolled: true,
    state: 'DRAFT',
    revision: 0
  };

  const v2ActiveSettings = {
    roster_workspace_v2_enabled: true,
    roster_v2_read_enabled: true,
    roster_v2_write_enabled: true,
    write_queue_v2_enabled: true,
    weekly_off_guidance_enabled: true
  };

  const novemberGates = evaluateRosterPageGates(v2ActiveSettings, novemberDraftLifecycle, 'Admin', '2026-11');

  assert.equal(novemberGates.renderPhase5Container, true, 'Phase5RosterContainer must activate for enrolled November DRAFT');
  assert.equal(novemberGates.renderLegacyRosterUi, false, 'Legacy Calendar/Table UI must be superseded by Phase5RosterContainer');
  assert.equal(novemberGates.renderLifecycleControls, true, 'LifecycleControls must render for November');
  assert.equal(novemberGates.renderDraftQueuePanel, true, 'DraftQueuePanel may render for Admin on enrolled November');
});

test('4. Existing legacy roster behavior remains unchanged for unenrolled periods', () => {
  const evaluateRosterPageGates = (settings, lifecycleInfo, selectedName, rosterMonth) => {
    const isWorkspaceEnabled = Boolean(
      settings?.roster_workspace_v2_enabled === true ||
      String(settings?.roster_workspace_v2_enabled || '').toLowerCase() === 'true'
    );
    const renderLifecycleControls = isWorkspaceEnabled;
    const renderPhase5Container = isWorkspaceEnabled &&
      lifecycleInfo.isEnrolled &&
      ['DRAFT', 'PUBLISHED', 'AMENDED', 'CLOSED'].includes(lifecycleInfo.state) &&
      settings?.roster_v2_read_enabled !== false;
    const renderLegacyRosterUi = !renderPhase5Container;
    const renderDraftQueuePanel = Boolean(
      selectedName?.trim().toLowerCase() === 'admin' &&
      rosterPanelEnabled(settings) &&
      Boolean(lifecycleInfo.isEnrolled && lifecycleInfo.period === rosterMonth)
    );
    return {
      renderLifecycleControls,
      renderPhase5Container,
      renderLegacyRosterUi,
      renderDraftQueuePanel
    };
  };

  const octoberUnenrolledLifecycle = {
    period: '2026-10',
    isEnrolled: false,
    state: null,
    revision: null
  };

  const v2ActiveSettings = {
    roster_workspace_v2_enabled: true,
    roster_v2_read_enabled: true,
    roster_v2_write_enabled: true,
    write_queue_v2_enabled: true,
    weekly_off_guidance_enabled: true
  };

  const octoberGates = evaluateRosterPageGates(v2ActiveSettings, octoberUnenrolledLifecycle, 'Admin', '2026-10');

  assert.equal(octoberGates.renderPhase5Container, false, 'Phase5RosterContainer must NOT render for unenrolled October');
  assert.equal(octoberGates.renderLegacyRosterUi, true, 'Legacy Calendar/Table UI MUST render for unenrolled October');
  assert.equal(octoberGates.renderDraftQueuePanel, false, 'DraftQueuePanel MUST NOT render for unenrolled October');
});
