function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function pick(entry, ...keys) {
  for (const key of keys) {
    if (entry && hasOwn(entry, key)) {
      return entry[key];
    }
  }
  return undefined;
}

export const mapName = (name) => {
  if (!name) return '';
  const upper = String(name).trim().toUpperCase();
  if (upper === 'SYU') return 'SYUHADA';
  return String(name).trim();
};


export function adaptRequestsResponse(data) {
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.rows)
      ? data.rows
      : Array.isArray(data?.values)
        ? data.values
        : [];

  return rows.map((entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const nameVal = mapName(pick(entry, 'name', 'Name') ?? '');
      const dateVal = pick(entry, 'date', 'Date') ?? '';
      const dayVal = pick(entry, 'day', 'Day') ?? '';
      const requestVal = pick(entry, 'request', 'Request') ?? '';
      const statusVal = pick(entry, 'status', 'Status') ?? '';
      const commentVal = pick(entry, 'comment', 'Comment') ?? '';
      const approvalStatusVal = pick(entry, 'approvalStatus', 'ApprovalStatus') || 'Approved';
      const swapPartnerVal = mapName(pick(entry, 'swapPartner', 'SwapPartner') ?? '');
      const requestTypeVal = pick(entry, 'requestType', 'RequestType') ?? 'Leave';

      return {
        id: pick(entry, 'id', 'ID', 'Id'),
        timestamp: pick(entry, 'timestamp', 'Timestamp'),
        name: nameVal,
        Name: nameVal,
        date: dateVal,
        Date: dateVal,
        day: dayVal,
        Day: dayVal,
        request: requestVal,
        Request: requestVal,
        status: statusVal,
        Status: statusVal,
        comment: commentVal,
        Comment: commentVal,
        ApprovalStatus: approvalStatusVal,
        approvalStatus: approvalStatusVal,
        SwapPartner: swapPartnerVal,
        swapPartner: swapPartnerVal,
        RequestType: requestTypeVal,
        requestType: requestTypeVal,
      };
    }

    return entry;
  });
}

export function validateMasterRoster(rawMasterRoster) {
  if (!Array.isArray(rawMasterRoster)) return [];
  return rawMasterRoster
    .filter((row) => row && (hasOwn(row, 'Shift') || hasOwn(row, 'shift')))
    .map((row) => {
      if (hasOwn(row, 'Name') || hasOwn(row, 'name')) {
        const name = mapName(row.Name || row.name || '');
        return {
          ...row,
          Name: name,
          name: name,
        };
      }
      return row;
    });
}

export function validateShiftBlocks(rawShiftBlocks) {
  return Array.isArray(rawShiftBlocks)
    ? rawShiftBlocks.filter((block) => block && (hasOwn(block, 'MaxSlots') || hasOwn(block, 'maxSlots')))
    : [];
}

export function validateShiftTypes(rawShiftTypes) {
  return Array.isArray(rawShiftTypes)
    ? rawShiftTypes.filter((type) => type && (hasOwn(type, 'Name') || hasOwn(type, 'name')))
    : [];
}

export function validateLimitGroups(rawLimitGroups) {
  return Array.isArray(rawLimitGroups)
    ? rawLimitGroups.filter((group) => group && (hasOwn(group, 'GroupName') || hasOwn(group, 'groupName')))
    : [];
}

export function normalizeActivities(rawActivities) {
  return Array.isArray(rawActivities)
    ? rawActivities
        .map((activity) => ({
          ID: String(pick(activity, 'ID', 'id', 'Id') || ''),
          Timestamp: pick(activity, 'Timestamp', 'timestamp') || '',
          CustomText: pick(activity, 'CustomText', 'customText') || '',
          Name: mapName(pick(activity, 'Name', 'name') || ''),
          RequestType: pick(activity, 'RequestType', 'requestType') || '',
          Request: pick(activity, 'Request', 'request') || '',
          SwapPartner: mapName(pick(activity, 'SwapPartner', 'swapPartner') || ''),
          Date: pick(activity, 'Date', 'date') || '',
          ApprovalStatus: pick(activity, 'ApprovalStatus', 'approvalStatus') || 'Approved',
          Comment: pick(activity, 'Comment', 'comment') || '',
          Status: pick(activity, 'Status', 'status') || 'Active',
        }))
        .filter((activity) => activity.ID && activity.ID.trim().toLowerCase() !== 'id' && (activity.CustomText || activity.Name))
    : [];
}

export function formatNameForMemo(name) {
  if (!name) return '';
  let str = String(name).trim();
  
  // Remove leading doctor title
  str = str.replace(/^(DR\.|DR\s|Dr\.|Dr\s)/i, '').trim();
  
  // Convert to title case
  return str.toLowerCase().split(' ').map(word => {
    // Preserve common particles normally if desired, but simple title case works for 'Bin', 'Binti', 'Md', etc.
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

export function resolveTeamMemberProfile(selectedName, teamMembers) {
  const defaultProfile = {
    name: selectedName,
    fullName: '',
    staffId: '',
    phone: '',
    email: ''
  };
  
  if (!Array.isArray(teamMembers) || !selectedName) {
    return defaultProfile;
  }
  
  const targetKey = mapName(selectedName).toLowerCase();
  
  const match = teamMembers.find(m => {
    if (!m) return false;
    const nameStr = typeof m === 'string' ? m : m.name;
    return mapName(nameStr).toLowerCase() === targetKey;
  });
  
  if (!match) return defaultProfile;
  
  if (typeof match === 'string') {
    return { ...defaultProfile, name: match };
  }
  
  return {
    name: match.name || selectedName,
    fullName: match.fullName || '',
    staffId: match.staffId || '',
    phone: match.phone || '',
    email: match.email || ''
  };
}
