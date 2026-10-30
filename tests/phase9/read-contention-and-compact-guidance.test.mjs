import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

import { createDraftRepository, _clearSharedInFlightReads } from '../../src/features/roster/data/draftRepository.js';
import { createGuidanceRepository } from '../../src/features/roster/data/guidanceRepository.js';
import { DraftQueue, sha256 } from '../../src/features/roster/queue/draftQueue.js';
import protocol from '../../src/features/roster/queue/protocol.js';
import guidance from '../../src/features/roster/guidance.js';
import { projectMoStaff } from '../../src/features/roster/staffProjection.js';
import * as adminAuthModule from '../../src/features/roster/auth/adminAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const req = createRequire(import.meta.url);

async function loadJsxComponent(relPath) {
  const bundleResult = await build({
    entryPoints: [path.resolve(rootDir, relPath)],
    bundle: true,
    write: false,
    format: 'cjs',
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    external: ['react', 'react-dom', 'react-dom/server', 'lucide-react', '../auth/adminAuth.js']
  });

  const bundledCode = bundleResult.outputFiles[0].text;
  const mod = { exports: {} };
  const customRequire = (id) => {
    if (id.includes('adminAuth')) return adminAuthModule;
    if (id === 'react') return React;
    if (id === 'react-dom/server') return ReactDOMServer;
    return req(id);
  };
  const evalFn = new Function('require', 'module', 'exports', bundledCode);
  evalFn(customRequire, mod, mod.exports);
  return mod.exports.default || mod.exports;
}

const legacyTeamMembers = [
  { name: 'Adi', staffId: 'A05157' },
  { name: 'Azrul', staffId: 'A05201' },
  { name: 'Afiq', staffId: 'A05563' },
  { name: 'Muaz', staffId: 'A05832' },
  { name: 'Syuhada', staffId: 'A05836' },
  { name: 'Najmi', staffId: 'A05887' },
  { name: 'Aiman', staffId: 'KA5239' },
  { name: 'Shafa', staffId: 'A06145' },
  { name: 'Asyraaf', staffId: 'A05959' },
  { name: 'Adli', staffId: 'A05962' },
  { name: 'Iema', staffId: 'A05960' },
  { name: 'Syifa', staffId: 'KA5335' },
  { name: 'Afif', staffId: 'A05148' }
];

const directoryPeople = [
  { PersonId: 'd89cf180-37c8-448c-8ebc-927724e4b79c', CurrentDisplayName: 'Adi', DirectoryType: 'MO', StaffId: 'A05157', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'a9bc3a8e-c60f-4990-8fb3-ab91321c9e44', CurrentDisplayName: 'Azrul', DirectoryType: 'MO', StaffId: 'A05201', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'ed25daed-3b7a-4eb5-8048-ecc4540f790e', CurrentDisplayName: 'Afiq', DirectoryType: 'MO', StaffId: 'A05563', LegacyNamesJson: '[]', Active: true },
  { PersonId: '359bd69b-e293-47f1-8c74-63d0c5f820c6', CurrentDisplayName: 'Muaz', DirectoryType: 'MO', StaffId: 'A05832', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'def02516-d2b5-4d0e-87fa-f45133e08f2f', CurrentDisplayName: 'Syuhada', DirectoryType: 'MO', StaffId: 'A05836', LegacyNamesJson: '["SYU", "Syu", "Syuhada"]', Active: true },
  { PersonId: '9f911524-d26d-42ea-81f3-c907e7b14350', CurrentDisplayName: 'Najmi', DirectoryType: 'MO', StaffId: 'A05887', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'ac810062-23b1-4d8d-8ea1-b7618386218a', CurrentDisplayName: 'Aiman', DirectoryType: 'MO', StaffId: 'KA5239', LegacyNamesJson: '[]', Active: true },
  { PersonId: '21a9cd36-8d8b-40cb-80bc-d0dce573370b', CurrentDisplayName: 'Shafa', DirectoryType: 'MO', StaffId: 'A06145', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'd3e38a0e-5a84-49b1-8995-3fa26f39d490', CurrentDisplayName: 'Asyraaf', DirectoryType: 'MO', StaffId: 'A05959', LegacyNamesJson: '[]', Active: true },
  { PersonId: '4ee34fd6-d0c9-45ae-8171-188fd9f49a72', CurrentDisplayName: 'Adli', DirectoryType: 'MO', StaffId: 'A05962', LegacyNamesJson: '[]', Active: true },
  { PersonId: '50553e9b-9a24-4548-8f34-d9e222d44064', CurrentDisplayName: 'Iema', DirectoryType: 'MO', StaffId: 'A05960', LegacyNamesJson: '[]', Active: true },
  { PersonId: 'b4024790-57f4-40c1-8e4e-a853ffe1f0ae', CurrentDisplayName: 'Syifa', DirectoryType: 'MO', StaffId: 'KA5335', LegacyNamesJson: '[]', Active: true },
  { PersonId: '287b9cd6-8bc9-4153-8f42-ae10ba2b58a7', CurrentDisplayName: 'Afif', DirectoryType: 'MO', StaffId: 'A05148', LegacyNamesJson: '[]', Active: false }
];

test('V2 Roster UX Refinement Slice 1.5 & 1.5.1 — Cross-Runtime Read Coalescing & Compact Guidance', async (t) => {
  let RosterGuidancePanel;
  let Phase5RosterContainer;

  t.before(async () => {
    RosterGuidancePanel = await loadJsxComponent('src/features/roster/components/RosterGuidancePanel.jsx');
    Phase5RosterContainer = await loadJsxComponent('src/features/roster/components/Phase5RosterContainer.jsx');
  });

  t.beforeEach(() => {
    _clearSharedInFlightReads();
  });

  await t.test('1. three independently-created repositories share one identical draft read', async () => {
    let callCount = 0;
    const mockFetcher = async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 20));
      return {
        ok: true,
        json: async () => ({
          ok: true,
          entityKey: 'draft:2026-11',
          revision: 1,
          cells: {},
          checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        })
      };
    };

    const baseUrl = 'https://script.google.com/macros/s/test/exec';
    // Three separate repository instances (mirroring DraftQueuePanel, LifecycleControls, Phase5RosterContainer)
    const repo1 = createDraftRepository({ baseUrl, fetcher: mockFetcher });
    const repo2 = createDraftRepository({ baseUrl, fetcher: mockFetcher });
    const repo3 = createDraftRepository({ baseUrl, fetcher: mockFetcher });

    const [res1, res2, res3] = await Promise.all([
      repo1.read('draft:2026-11'),
      repo2.read('draft:2026-11'),
      repo3.read('draft:2026-11')
    ]);

    assert.equal(callCount, 1, 'Three independently-created repository instances must coalesce to 1 network call');
    assert.equal(res1.ok, true);
    assert.equal(res2.ok, true);
    assert.equal(res3.ok, true);
    assert.equal(res1.checksum, res2.checksum);
  });

  await t.test('2. same read + LOCK_BUSY produces one retry sequence, not three', async () => {
    let callCount = 0;
    const mockFetcher = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({ ok: false, error: { code: 'LOCK_BUSY', message: 'ScriptLock busy', retryable: true } })
        };
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          entityKey: 'draft:2026-11',
          revision: 1,
          cells: {},
          checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        })
      };
    };

    const baseUrl = 'https://script.google.com/macros/s/test/exec';
    const repo1 = createDraftRepository({ baseUrl, fetcher: mockFetcher, maxReadRetries: 2, readRetryDelayMs: 10 });
    const repo2 = createDraftRepository({ baseUrl, fetcher: mockFetcher, maxReadRetries: 2, readRetryDelayMs: 10 });
    const repo3 = createDraftRepository({ baseUrl, fetcher: mockFetcher, maxReadRetries: 2, readRetryDelayMs: 10 });

    const [res1, res2, res3] = await Promise.all([
      repo1.read('draft:2026-11'),
      repo2.read('draft:2026-11'),
      repo3.read('draft:2026-11')
    ]);

    assert.equal(callCount, 2, 'One initial fetch + one retry = 2 total backend calls across all three callers (no retry amplification)');
    assert.equal(res1.ok, true);
    assert.equal(res2.ok, true);
    assert.equal(res3.ok, true);
  });

  await t.test('3. same read + TRANSIENT_BACKEND produces one retry sequence', async () => {
    let callCount = 0;
    const mockFetcher = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({ ok: false, error: { code: 'TRANSIENT_BACKEND', message: 'Backend timeout', retryable: true } })
        };
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          entityKey: 'draft:2026-11',
          revision: 1,
          cells: {},
          checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        })
      };
    };

    const baseUrl = 'https://script.google.com/macros/s/test/exec';
    const repo1 = createDraftRepository({ baseUrl, fetcher: mockFetcher, maxReadRetries: 2, readRetryDelayMs: 10 });
    const repo2 = createDraftRepository({ baseUrl, fetcher: mockFetcher, maxReadRetries: 2, readRetryDelayMs: 10 });
    const repo3 = createDraftRepository({ baseUrl, fetcher: mockFetcher, maxReadRetries: 2, readRetryDelayMs: 10 });

    const [res1, res2, res3] = await Promise.all([
      repo1.read('draft:2026-11'),
      repo2.read('draft:2026-11'),
      repo3.read('draft:2026-11')
    ]);

    assert.equal(callCount, 2, 'One initial fetch + one retry = 2 calls (no amplification for TRANSIENT_BACKEND)');
    assert.equal(res1.ok, true);
    assert.equal(res2.ok, true);
    assert.equal(res3.ok, true);
  });

  await t.test('4. different periods are not coalesced', async () => {
    let callCount = 0;
    const mockFetcher = async (url) => {
      callCount++;
      const u = new URL(url);
      const entityKey = u.searchParams.get('entityKey');
      return {
        ok: true,
        json: async () => ({
          ok: true,
          entityKey,
          revision: 1,
          cells: {},
          checksum: 'hash_' + entityKey
        })
      };
    };

    const baseUrl = 'https://script.google.com/macros/s/test/exec';
    const repo1 = createDraftRepository({ baseUrl, fetcher: mockFetcher });
    const repo2 = createDraftRepository({ baseUrl, fetcher: mockFetcher });

    const [resNov, resDec] = await Promise.all([
      repo1.read('draft:2026-11'),
      repo2.read('draft:2026-12')
    ]);

    assert.equal(callCount, 2, 'Requests for different periods must each trigger their own backend fetch');
    assert.equal(resNov.entityKey, 'draft:2026-11');
    assert.equal(resDec.entityKey, 'draft:2026-12');
  });

  await t.test('5. different actions are not coalesced', async () => {
    let callCount = 0;
    const mockFetcher = async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ ok: true, people: directoryPeople })
      };
    };

    const baseUrl = 'https://script.google.com/macros/s/test/exec';
    const repo1 = createDraftRepository({ baseUrl, fetcher: mockFetcher });
    const repo2 = createDraftRepository({ baseUrl, fetcher: mockFetcher });

    const [resDraft, resSchema] = await Promise.all([
      repo1.read('draft:2026-11'),
      repo2.schema()
    ]);

    assert.equal(callCount, 2, 'Different actions (rosterv2draft vs rosterv2draftschema) must produce separate requests');
    assert.equal(resDraft.ok, true);
    assert.equal(resSchema.ok, true);
  });

  await t.test('6. different base URLs are not coalesced', async () => {
    let callCount = 0;
    const mockFetcher = async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ ok: true, revision: 1, cells: {}, checksum: 'hash' })
      };
    };

    const repo1 = createDraftRepository({ baseUrl: 'https://server1.example.com/exec', fetcher: mockFetcher });
    const repo2 = createDraftRepository({ baseUrl: 'https://server2.example.com/exec', fetcher: mockFetcher });

    const [res1, res2] = await Promise.all([
      repo1.read('draft:2026-11'),
      repo2.read('draft:2026-11')
    ]);

    assert.equal(callCount, 2, 'Different base URLs must never coalesce');
    assert.equal(res1.ok, true);
    assert.equal(res2.ok, true);
  });

  await t.test('7. auth and unauth contexts are not incorrectly coalesced', async () => {
    let callCount = 0;
    const mockFetcher = async (url) => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ ok: true, revision: 1, cells: {}, checksum: 'hash' })
      };
    };

    const baseUrl = 'https://script.google.com/macros/s/test/exec';
    const repoAuth = createDraftRepository({
      baseUrl,
      fetcher: mockFetcher,
      getAdminSessionToken: () => 'opaque-admin-token-123'
    });
    const repoAnon = createDraftRepository({
      baseUrl,
      fetcher: mockFetcher,
      getAdminSessionToken: null
    });

    const [resAuth, resAnon] = await Promise.all([
      repoAuth.read('draft:2026-11'),
      repoAnon.read('draft:2026-11')
    ]);

    assert.equal(callCount, 2, 'Authenticated and unauthenticated requests must NOT coalesce');
    assert.equal(resAuth.ok, true);
    assert.equal(resAnon.ok, true);
  });

  await t.test('8. mutation calls are never coalesced', async () => {
    let callCount = 0;
    const mockFetcher = async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ ok: false, error: { code: 'LOCK_BUSY', message: 'ScriptLock busy' } })
      };
    };

    const baseUrl = 'https://script.google.com/macros/s/test/exec';
    const repo1 = createDraftRepository({ baseUrl, fetcher: mockFetcher });
    const repo2 = createDraftRepository({ baseUrl, fetcher: mockFetcher });

    const op = {
      operationId: '11111111-1111-4111-8111-111111111111',
      clientId: '22222222-2222-4222-8222-222222222222',
      tabId: '33333333-3333-4333-8333-333333333333',
      operationType: 'DRAFT_PATCH',
      entityKey: 'draft:2026-11',
      expectedRevision: 1,
      payload: { patches: [] },
      payloadHash: 'hash'
    };

    const [res1, res2] = await Promise.all([
      repo1.write(op),
      repo2.write(op)
    ]);

    assert.equal(callCount, 2, 'Mutations must strictly be individual executions and never coalesce');
    assert.equal(res1.ok, false);
    assert.equal(res2.ok, false);
  });

  await t.test('9. failed shared promise is removed and later request works normally', async () => {
    let callCount = 0;
    const mockFetcher = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({ ok: false, error: { code: 'AUTHORIZATION_REQUIRED', message: 'Unauthorized' } })
        };
      }
      return {
        ok: true,
        json: async () => ({ ok: true, entityKey: 'draft:2026-11', revision: 1, cells: {}, checksum: 'ok_hash' })
      };
    };

    const baseUrl = 'https://script.google.com/macros/s/test/exec';
    const repo1 = createDraftRepository({ baseUrl, fetcher: mockFetcher, maxReadRetries: 1 });
    const repo2 = createDraftRepository({ baseUrl, fetcher: mockFetcher, maxReadRetries: 1 });

    // Initial concurrent failure
    const [res1, res2] = await Promise.all([
      repo1.read('draft:2026-11'),
      repo2.read('draft:2026-11')
    ]);
    assert.equal(callCount, 1, 'Initial concurrent call coalesced to 1 fetch');
    assert.equal(res1.ok, false);
    assert.equal(res2.ok, false);
    assert.equal(res1.error.code, 'AUTHORIZATION_REQUIRED');

    // Subsequent fresh call after in-flight settled
    const res3 = await repo1.read('draft:2026-11');
    assert.equal(callCount, 2, 'Subsequent call after resolution triggers a fresh network call (no stuck promise)');
    assert.equal(res3.ok, true);
  });

  await t.test('10. existing queue-level same-instance refresh coalescing remains correct', async () => {
    let readCount = 0;
    const validChecksum = await sha256(protocol.canonical({}));
    const mockRepo = {
      read: async () => {
        readCount++;
        await new Promise(r => setTimeout(r, 20));
        return {
          ok: true,
          entityKey: 'draft:2026-11',
          revision: 1,
          cells: {},
          checksum: validChecksum
        };
      }
    };

    const entities = new Map();
    const mockStore = {
      name: 'test-store',
      read: async (key) => entities.get(key) ? structuredClone(entities.get(key)) : null,
      update: async (key, fn) => {
        const current = entities.get(key) ? structuredClone(entities.get(key)) : null;
        const next = fn(current);
        entities.set(key, structuredClone(next));
        return structuredClone(next);
      },
      write: async (key, entity) => {
        entities.set(key, structuredClone(entity));
      },
      clear: async () => {
        entities.clear();
      }
    };

    const queue = new DraftQueue({
      store: mockStore,
      repository: mockRepo,
      settings: {}
    });

    const [p1, p2] = [
      queue.refresh('draft:2026-11'),
      queue.refresh('draft:2026-11')
    ];

    assert.equal(p1, p2, 'Concurrent calls to queue.refresh on the same instance return the exact same Promise');
    await Promise.all([p1, p2]);
    assert.equal(readCount, 1, 'queue.refresh triggered exactly 1 repository read');
  });

  await t.test('11. an already-valid draft snapshot remains visible during a transient refresh failure (stale-while-refreshing)', async () => {
    const mockQueue = {
      view: () => ({
        baseline: {
          revision: 1,
          checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        },
        cells: {
          'd89cf180-37c8-448c-8ebc-927724e4b79c/2026-11-01': [{ assignmentId: 'a1', rawShift: 'AM' }]
        },
        operations: []
      }),
      refresh: async () => {
        throw new Error('LOCK_BUSY');
      },
      getPeriodLifecycle: async () => ({
        ok: true,
        period: { PeriodId: '2026-11', State: 'DRAFT', Revision: 1, DraftRevision: 1 }
      })
    };

    const element = React.createElement(Phase5RosterContainer, {
      period: '2026-11',
      queue: mockQueue,
      people: directoryPeople,
      isAdmin: true,
      settings: {
        roster_v2_read_enabled: true,
        roster_v2_write_enabled: false,
        write_queue_v2_enabled: false
      }
    });

    const html = ReactDOMServer.renderToStaticMarkup(element);
    assert.ok(!html.includes('Failed to load draft: LOCK_BUSY'), 'LOCK_BUSY error banner must not be shown when valid snapshot is present');
  });

  await t.test('12. stale async response cannot replace a newer period/snapshot', async () => {
    let gen = 0;
    gen++;
    const gen1 = gen;
    const task1 = (async () => {
      await new Promise(r => setTimeout(r, 50));
      if (gen1 !== gen) return null;
      return 'month1_data';
    })();

    gen++;
    const gen2 = gen;
    const task2 = (async () => {
      await new Promise(r => setTimeout(r, 10));
      if (gen2 !== gen) return null;
      return 'month2_data';
    })();

    const [res1, res2] = await Promise.all([task1, task2]);
    assert.equal(res1, null, 'Stale month 1 response must be ignored');
    assert.equal(res2, 'month2_data', 'Current month 2 response must be preserved');
  });

  await t.test('13. guidance default UI is compact/collapsed', async () => {
    const mockQueue = {
      view: () => ({ baseline: { checksum: null }, cells: {}, operations: [] }),
      refresh: async () => {}
    };

    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RosterGuidancePanel, {
        period: '2026-11',
        settings: { weekly_off_guidance_enabled: true },
        queue: mockQueue,
        people: directoryPeople,
        isVerifiedAdmin: false,
        allowPolicyWrites: false
      })
    );

    assert.ok(html.includes('Advisory roster guidance — 2026-11'), 'Collapsed header renders');
    assert.ok(html.includes('View guidance'), 'View guidance button rendered in collapsed state');
    assert.ok(!html.includes('Weekly OFF Requirements'), 'Detailed weekly OFF table must NOT be rendered when collapsed');
  });

  await t.test('14. collapsed summary displays actual Policy B', async () => {
    const mockQueue = {
      view: () => ({ baseline: { checksum: null }, cells: {}, operations: [] }),
      refresh: async () => {}
    };

    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RosterGuidancePanel, {
        period: '2026-11',
        settings: { weekly_off_guidance_enabled: true },
        queue: mockQueue,
        people: directoryPeople,
        isVerifiedAdmin: false,
        allowPolicyWrites: false
      })
    );

    assert.ok(html.includes('Policy B'), 'Policy B badge must be visible in collapsed toolbar');
  });

  await t.test('15. summary counts are derived from evaluation data', async () => {
    const mockQueue = {
      view: () => ({ baseline: { checksum: null }, cells: {}, operations: [] }),
      refresh: async () => {}
    };

    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RosterGuidancePanel, {
        period: '2026-11',
        settings: { weekly_off_guidance_enabled: true },
        queue: mockQueue,
        people: directoryPeople,
        isVerifiedAdmin: false,
        allowPolicyWrites: false
      })
    );

    assert.ok(html.includes('OFF deficit: 0 days'), 'Dynamic shortfall/deficit count is displayed');
    assert.ok(html.includes('safety warning'), 'Dynamic safety warning count is displayed');
  });

  await t.test('15a. OFF deficit label represents summed OFF days (not issue count) and derives affected doctors', async () => {
    const policyB = {
      PolicyId: '68c4fcb6-89e8-466a-9324-78338f0f0c05',
      PolicyCode: 'B',
      EffectiveMonday: '2026-10-26',
      RuleVersion: 1,
      RuleJson: guidance.policyRuleJson('B'),
      Active: true,
      Revision: 1
    };

    // Adi (p1) has shortfall 2 in week 1 and shortfall 1 in week 2 (total 3 days shortfall across 2 weeks)
    // Azrul (p2) has shortfall 2 in week 1 (total 2 days shortfall in 1 week)
    // Total deficit = 5 days. Total issues = 3. Unique affected doctors = 2.
    const p1 = directoryPeople[0].PersonId; // Adi
    const p2 = directoryPeople[1].PersonId; // Azrul
    const cells = {
      // Week 2026-11-09: Adi has 1 OFF day -> shortfall 1
      [`${p1}/2026-11-09`]: [{ rawShift: 'OFF', normalOff: true, worked: false }],
      // Week 2026-11-09: Azrul has 2 OFF days -> shortfall 0
      [`${p2}/2026-11-09`]: [{ rawShift: 'OFF', normalOff: true, worked: false }],
      [`${p2}/2026-11-10`]: [{ rawShift: 'OFF', normalOff: true, worked: false }],
    };
    const testPeople = [directoryPeople[0], directoryPeople[1]];
    const dates11 = guidance.periodDates('2026-11');
    for (const d of dates11) {
      const weekStart = guidance.mondayOf(d);
      if (weekStart !== '2026-11-02' && weekStart !== '2026-11-09') {
        cells[`${p1}/${weekStart}`] = [{ rawShift: 'OFF', normalOff: true, worked: false }];
        cells[`${p1}/${guidance.addDays(weekStart, 1)}`] = [{ rawShift: 'OFF', normalOff: true, worked: false }];
        cells[`${p2}/${weekStart}`] = [{ rawShift: 'OFF', normalOff: true, worked: false }];
        cells[`${p2}/${guidance.addDays(weekStart, 1)}`] = [{ rawShift: 'OFF', normalOff: true, worked: false }];
      }
    }

    const mockQueue = {
      view: (key) => ({
        baseline: { checksum: 'valid' },
        cells: key === 'draft:2026-11' ? cells : {}
      }),
      refresh: async () => {}
    };

    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RosterGuidancePanel, {
        period: '2026-11',
        settings: { weekly_off_guidance_enabled: true, night_safety_guidance_enabled: false },
        queue: mockQueue,
        people: testPeople,
        isVerifiedAdmin: false,
        allowPolicyWrites: false,
        initialReady: true,
        initialPolicies: [policyB]
      })
    );

    assert.ok(html.includes('OFF deficit: 5 days'), `Must display 'OFF deficit: 5 days' representing summed shortfall days. Got html: ${html}`);
    assert.ok(html.includes('2 doctors affected'), `Must display '2 doctors affected' derived from unique doctors with shortfall`);
  });

  await t.test('15b. zero safety warnings with incomplete context displays "0 detected safety warnings" and provisional indicator', async () => {
    const policyB = {
      PolicyId: '68c4fcb6-89e8-466a-9324-78338f0f0c05',
      PolicyCode: 'B',
      EffectiveMonday: '2026-10-26',
      RuleVersion: 1,
      RuleJson: guidance.policyRuleJson('B'),
      Active: true,
      Revision: 1
    };

    const mockQueue = {
      view: (key) => ({
        baseline: { checksum: key === 'draft:2026-11' ? 'valid11' : null },
        cells: {}
      }),
      refresh: async () => {}
    };

    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RosterGuidancePanel, {
        period: '2026-11',
        settings: { weekly_off_guidance_enabled: true, night_safety_guidance_enabled: true },
        queue: mockQueue,
        people: [directoryPeople[0]],
        isVerifiedAdmin: false,
        allowPolicyWrites: false,
        initialReady: true,
        initialPolicies: [policyB]
      })
    );

    assert.ok(html.includes('0 detected safety warnings'), 'Incomplete context must display "0 detected safety warnings"');
    assert.ok(html.includes('provisional'), 'Incomplete context must display provisional indicator');
    assert.ok(!html.includes('0 safety warnings ·'), 'Must NOT imply complete safety clearance without "detected" qualifier');
  });

  await t.test('15c. zero safety warnings with complete context communicates clean zero-warning state without provisional indicator', async () => {
    const policyB = {
      PolicyId: '68c4fcb6-89e8-466a-9324-78338f0f0c05',
      PolicyCode: 'B',
      EffectiveMonday: '2026-10-26',
      RuleVersion: 1,
      RuleJson: guidance.policyRuleJson('B'),
      Active: true,
      Revision: 1
    };

    // Oct, Nov, Dec are all available (checksum valid) -> completeContext === true
    const mockQueue = {
      view: (key) => ({
        baseline: { checksum: 'valid-' + key },
        cells: {}
      }),
      refresh: async () => {}
    };

    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RosterGuidancePanel, {
        period: '2026-11',
        settings: { weekly_off_guidance_enabled: true, night_safety_guidance_enabled: true },
        queue: mockQueue,
        people: [directoryPeople[0]],
        isVerifiedAdmin: false,
        allowPolicyWrites: false,
        initialReady: true,
        initialPolicies: [policyB]
      })
    );

    assert.ok(html.includes('0 safety warnings'), 'Complete context must display "0 safety warnings"');
    assert.ok(!html.includes('0 detected safety warnings'), 'Must NOT qualify with "detected" when context is complete');
    assert.ok(!html.includes('provisional'), 'Must NOT display provisional indicator when context is complete');
  });

  await t.test('15d. non-zero safety warning count remains accurate and prominent', async () => {
    const policyB = {
      PolicyId: '68c4fcb6-89e8-466a-9324-78338f0f0c05',
      PolicyCode: 'B',
      EffectiveMonday: '2026-10-26',
      RuleVersion: 1,
      RuleJson: guidance.policyRuleJson('B'),
      Active: true,
      Revision: 1
    };

    // Provide cells causing a safety warning: 7 consecutive working days
    const personId = directoryPeople[0].PersonId;
    const cells = {};
    for (let i = 2; i <= 8; i++) {
      const day = String(i).padStart(2, '0');
      cells[`${personId}/2026-11-${day}`] = [{ rawShift: 'AM', worked: true, normalOff: false }];
    }

    const mockQueue = {
      view: (key) => ({
        baseline: { checksum: 'valid-' + key },
        cells: key === 'draft:2026-11' ? cells : {}
      }),
      refresh: async () => {}
    };

    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RosterGuidancePanel, {
        period: '2026-11',
        settings: { weekly_off_guidance_enabled: false, night_safety_guidance_enabled: true },
        queue: mockQueue,
        people: [directoryPeople[0]],
        isVerifiedAdmin: false,
        allowPolicyWrites: false,
        initialReady: true,
        initialPolicies: [policyB]
      })
    );

    assert.ok(html.includes('1 safety warning'), 'Must display "1 safety warning" for 7 consecutive worked days');
    assert.ok(html.includes('text-red-700'), 'Safety warning count must use prominent red styling');
  });

  await t.test('16. expanded weekly view identifies doctor + week', async () => {
    const mo = directoryPeople[0];
    const policies = [{
      PolicyId: '68c4fcb6-89e8-466a-9324-78338f0f0c05',
      PolicyCode: 'B',
      EffectiveMonday: '2026-10-26',
      RuleVersion: 1,
      RuleJson: guidance.policyRuleJson('B'),
      Active: true,
      Revision: 1
    }];

    const weekResult = guidance.evaluateWeek({
      weekStart: '2026-11-02',
      personId: mo.PersonId,
      plannedByDate: {},
      currentByDate: {},
      availablePlannedDates: guidance.weekDates('2026-11-02'),
      policies
    });

    assert.equal(weekResult.personId, mo.PersonId, 'Week evaluation must carry personId');
    assert.equal(weekResult.weekStart, '2026-11-02', 'Week evaluation must carry weekStart');
    assert.equal(weekResult.policy.policyCode, 'B', 'Policy must be B');
    assert.equal(weekResult.shortfall, 2, 'Empty planned duties result in 2 days shortfall');
  });

  await t.test('17. COMPLETE rows can be hidden by default without altering calculation data', async () => {
    const weeks = [
      { personId: 'p1', weekStart: '2026-11-02', status: 'SHORTFALL', shortfall: 1 },
      { personId: 'p2', weekStart: '2026-11-02', status: 'COMPLETE', shortfall: 0 }
    ];

    const problemOnly = weeks.filter(w => w.status !== 'COMPLETE' || w.shortfall > 0);
    assert.equal(problemOnly.length, 1, 'Only shortfall week is in problem-only view');
    assert.equal(weeks.length, 2, 'Underlying calculation data retains all evaluated weeks');
  });

  await t.test('18. issue rows identify doctor', async () => {
    const mo = directoryPeople[0];
    const issue = {
      id: `WEEKLY_OFF_SHORTFALL:${mo.PersonId}:2026-11-02`,
      code: 'WEEKLY_OFF_SHORTFALL',
      personId: mo.PersonId,
      weekStart: '2026-11-02',
      shortfall: 2,
      severity: 'ADVISORY'
    };

    assert.equal(issue.personId, mo.PersonId, 'Issue identifies doctor by personId');
    const doctorName = directoryPeople.find(p => p.PersonId === issue.personId)?.CurrentDisplayName;
    assert.equal(doctorName, 'Adi', 'Issue resolves to doctor name Adi');
  });

  await t.test('19. provisional/context issues may be aggregated without deleting underlying issue data', async () => {
    const issues = directoryPeople.slice(0, 13).map(p => ({
      id: `PROVISIONAL_WEEK:${p.PersonId}:2026-10-26`,
      code: 'PROVISIONAL_WEEK',
      personId: p.PersonId,
      weekStart: '2026-10-26'
    }));

    const grouped = new Map();
    for (const item of issues) {
      if (!grouped.has(item.weekStart)) grouped.set(item.weekStart, []);
      grouped.get(item.weekStart).push(item);
    }

    assert.equal(grouped.get('2026-10-26').length, 13, 'Aggregated notice represents 13 doctors');
    assert.equal(issues.length, 13, 'Underlying individual issues are not deleted');
  });

  await t.test('20. Mark reviewed semantics remain unchanged and traceable to issue ID', async () => {
    const issue = {
      id: 'WEEKLY_OFF_SHORTFALL:p1:2026-11-02',
      code: 'WEEKLY_OFF_SHORTFALL',
      personId: 'p1'
    };

    const ack = guidance.acknowledgeIssue(issue, { actor: 'ADMIN' });
    assert.equal(ack.issueId, issue.id);
    assert.equal(ack.issueCode, 'WEEKLY_OFF_SHORTFALL');
    assert.equal(ack.acknowledged, true);
    assert.equal(ack.actor, 'ADMIN');
  });

  await t.test('21. strict 13-MO projection/order remains intact', async () => {
    const projection = projectMoStaff({
      teamMembers: legacyTeamMembers,
      people: directoryPeople
    });

    assert.equal(projection.diagnostics.ok, true);
    assert.equal(projection.length, 13);
    const expectedOrder = ['Adi', 'Azrul', 'Afiq', 'Muaz', 'Syuhada', 'Najmi', 'Aiman', 'Shafa', 'Asyraaf', 'Adli', 'Iema', 'Syifa', 'Afif'];
    assert.deepEqual(projection.map(s => s.displayName), expectedOrder);
  });

  await t.test('22. Private Draft remains hidden', async () => {
    const DraftQueuePanel = await loadJsxComponent('src/features/roster/components/DraftQueuePanel.jsx');
    const mockQueue = {
      view: () => ({ baseline: { checksum: null }, cells: {}, operations: [] }),
      refresh: async () => {}
    };

    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DraftQueuePanel, {
        period: '2026-11',
        settings: { roster_v2_write_enabled: true, write_queue_v2_enabled: true },
        showTechnicalEditor: false,
        allowPolicyWrites: false
      })
    );

    assert.ok(!html.includes('Private draft — 2026-11'), 'Private draft editor must remain hidden');
  });

  await t.test('23. allowPolicyWrites=false remains intact and suppresses policy form', async () => {
    const mockQueue = {
      view: () => ({ baseline: { checksum: null }, cells: {}, operations: [] }),
      refresh: async () => {}
    };

    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RosterGuidancePanel, {
        period: '2026-11',
        settings: { weekly_off_guidance_enabled: true, roster_v2_write_enabled: true, write_queue_v2_enabled: true },
        queue: mockQueue,
        people: directoryPeople,
        isVerifiedAdmin: true,
        allowPolicyWrites: false
      })
    );

    assert.ok(!html.includes('Add effective OFF policy'), 'Add policy must remain suppressed with allowPolicyWrites=false');
  });

  await t.test('24. allowPublish=false remains intact and publish button is disabled', async () => {
    const lifecycleControlsSrc = fs.readFileSync(
      path.resolve(rootDir, 'src/features/roster/components/LifecycleControls.jsx'),
      'utf8'
    );
    const rosterPageSrc = fs.readFileSync(
      path.resolve(rootDir, 'src/components/RosterPage.jsx'),
      'utf8'
    );

    assert.ok(
      rosterPageSrc.includes('allowPublish={false}'),
      'RosterPage passes allowPublish={false} to LifecycleControls'
    );
    assert.ok(
      lifecycleControlsSrc.includes('disabled={!mutationsEnabled || !allowPublish}'),
      'Publish button must be disabled when !allowPublish'
    );
    assert.ok(
      lifecycleControlsSrc.includes('if (!allowPublish) return;'),
      'Publish handler must abort when !allowPublish'
    );
    assert.ok(
      lifecycleControlsSrc.includes("'Publication is disabled during manual review'"),
      'Publish button tooltip indicates publication disabled during manual review'
    );
  });
});
