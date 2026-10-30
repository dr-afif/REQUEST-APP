import contract from './compatibility.js';

// Explicit diagnostic helper; never mounted by the legacy UI or refresh loop.
export function compareLegacyPeriod(periodId, legacyRows, serverProjection) {
  contract.validatePeriod(periodId);
  if (serverProjection?.schemaVersion !== 2 || serverProjection.period?.periodId !== periodId || serverProjection.projectionKind !== 'LEGACY_SHADOW') {
    throw new Error('Unsupported or mismatched shadow period response');
  }
  const expected = contract.legacyTransportRows(legacyRows.filter(row => contract.localDate(row.Date)?.slice(0, 7) === periodId));
  const localUnplacedCount = legacyRows.filter(row => !contract.localDate(row.Date)).length;
  return { ...contract.reconcileRows(expected, contract.legacyProjection(serverProjection)),
    complete: localUnplacedCount === 0 && serverProjection.unplaced.length === 0,
    localUnplacedCount, unplacedCount: serverProjection.unplaced.length };
}

export async function snapshotChecksums(datasets) {
  const snapshots = contract.snapshotDatasets(datasets, text => text);
  const digest = async text => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  return Promise.all(snapshots.map(async snapshot => ({ ...snapshot,
    headerChecksum: await digest(snapshot.headerChecksum), rowChecksum: await digest(snapshot.rowChecksum), checksum: await digest(snapshot.checksum) })));
}
