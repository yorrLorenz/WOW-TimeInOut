import { openDB } from 'idb';

const DB_NAME = 'timeinout-db';
const DB_VERSION = 5;

/** SHA-256 hash of a PIN string → 64-char hex. Uses Web Crypto API. */
export async function hashPin(pin) {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(pin));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, transaction) {
        // ── Fresh install ────────────────────────────────────────────────
        if (oldVersion < 1) {
          const branchStore = db.createObjectStore('branches', { keyPath: 'code' });
          branchStore.createIndex('name', 'name');

          const empStore = db.createObjectStore('employees', {
            keyPath: 'id',
            autoIncrement: true,
          });
          empStore.createIndex('name', 'name');

          const logStore = db.createObjectStore('logs', {
            keyPath: 'id',
            autoIncrement: true,
          });
          logStore.createIndex('employeeId', 'employeeId');
          logStore.createIndex('branchCode', 'branchCode');
          logStore.createIndex('date', 'date');
          logStore.createIndex('employeeDate', ['employeeId', 'date']);
        }

        // ── Migrate v1 → v2: branchCode → homeBranch on employees ────────
        if (oldVersion === 1) {
          const empStore = transaction.objectStore('employees');
          let cursor = await empStore.openCursor();
          while (cursor) {
            if ('branchCode' in cursor.value) {
              const updated = { ...cursor.value, homeBranch: cursor.value.branchCode };
              delete updated.branchCode;
              await cursor.update(updated);
            }
            cursor = await cursor.continue();
          }
          if (empStore.indexNames.contains('branchCode')) {
            empStore.deleteIndex('branchCode');
          }
        }

        // ── Migrate v2 → v3: add uid to employees, add branchIn/branchOut to logs ─
        if (oldVersion < 3 && oldVersion >= 1) {
          // Seed UIDs for existing employees that don't have one
          const empStore = transaction.objectStore('employees');
          let empCursor = await empStore.openCursor();
          while (empCursor) {
            if (!empCursor.value.uid) {
              const uid = `EMP-${String(empCursor.value.id).padStart(4, '0')}`;
              await empCursor.update({ ...empCursor.value, uid });
            }
            empCursor = await empCursor.continue();
          }

          // Back-fill branchIn / branchOut on existing logs
          const logStore = transaction.objectStore('logs');
          let logCursor = await logStore.openCursor();
          while (logCursor) {
            const log = logCursor.value;
            if (!log.branchIn) {
              await logCursor.update({
                ...log,
                branchIn: log.branchCode,
                branchOut: log.timeOut ? log.branchCode : null,
              });
            }
            logCursor = await logCursor.continue();
          }
        }

        // ── Fresh install: seed SUPER-ADMIN only (branches come from Sheets) ─
        if (oldVersion === 0) {
          const branchStore = transaction.objectStore('branches');
          // Seed with hashed PIN so fresh installs are secure from the start
          const hashed = await hashPin('admin1234');
          await branchStore.add({
            code: 'SUPER-ADMIN',
            name: 'Super Admin',
            pin: hashed,
            isAdmin: true,
          });
        }

        // ── v3 → v4: remove hardcoded test branches ───────────────────────
        if (oldVersion < 4 && oldVersion >= 1) {
          const branchStore = transaction.objectStore('branches');
          for (const code of ['MAIN-001', 'NORTH-002', 'SOUTH-003']) {
            const existing = await branchStore.get(code);
            if (existing) await branchStore.delete(code);
          }
        }

        // ── v4 → v5: hash SUPER-ADMIN PIN; backfill uid+name in logs ──────
        if (oldVersion < 5 && oldVersion >= 1) {
          // Hash the SUPER-ADMIN PIN if it's still plaintext
          const branchStore = transaction.objectStore('branches');
          const admin = await branchStore.get('SUPER-ADMIN');
          if (admin && admin.pin && !/^[0-9a-f]{64}$/.test(admin.pin)) {
            await branchStore.put({ ...admin, pin: await hashPin(admin.pin) });
          }

          // Backfill uid + employeeName into existing logs so they can be
          // synced even after the employee store is cleared on next startup.
          const logStore = transaction.objectStore('logs');
          const empStore = transaction.objectStore('employees');
          const allEmps  = await empStore.getAll();
          const idToEmp  = {};
          for (const e of allEmps) idToEmp[e.id] = e;

          let logCursor = await logStore.openCursor();
          while (logCursor) {
            if (!logCursor.value.uid) {
              const emp = idToEmp[logCursor.value.employeeId];
              await logCursor.update({
                ...logCursor.value,
                uid:          emp?.uid  || '',
                employeeName: emp?.name || '',
              });
            }
            logCursor = await logCursor.continue();
          }
        }
      },
    });
  }
  return dbPromise;
}

// ── Branches ────────────────────────────────────────────────────────────────

export async function getBranch(code) {
  const db = await getDB();
  return db.get('branches', code);
}

export async function getAllBranches() {
  const db = await getDB();
  return db.getAll('branches');
}

export async function saveBranch(branch) {
  const db = await getDB();
  return db.put('branches', branch);
}

export async function deleteBranch(code) {
  const db = await getDB();
  return db.delete('branches', code);
}

/**
 * Merge branches pulled from Sheets into local IndexedDB.
 * - New branch → add it (Sheets is source of truth for custom branches)
 * - Existing branch with changed name/PIN → update it
 */
export async function mergeBranchesFromRemote(remoteBranches) {
  let added = 0, updated = 0;
  for (const remote of remoteBranches) {
    if (!remote.code) continue;
    const local = await getBranch(remote.code);
    if (!local) {
      await saveBranch({ code: remote.code, name: remote.name, pin: remote.pin, isAdmin: remote.isAdmin ?? false });
      added++;
    } else if (local.name !== remote.name || local.pin !== remote.pin) {
      await saveBranch({ ...local, name: remote.name, pin: remote.pin });
      updated++;
    }
  }
  return { added, updated };
}

// ── Employees ───────────────────────────────────────────────────────────────

export async function getEmployee(id) {
  const db = await getDB();
  return db.get('employees', id);
}

export async function getEmployeesByBranch(branchCode) {
  const db = await getDB();
  const all = await db.getAll('employees');
  return all.filter((e) => e.homeBranch === branchCode);
}

export async function getAllEmployees() {
  const db = await getDB();
  return db.getAll('employees');
}

/**
 * Register a new employee, auto-generating a UID (EMP-0001 format).
 * Use this instead of saveEmployee() for new registrations.
 */
export async function registerEmployee(employee) {
  const db = await getDB();
  // add() returns the new auto-increment id
  const id = await db.add('employees', { ...employee, uid: '' });
  const uid = `EMP-${String(id).padStart(4, '0')}`;
  await db.put('employees', { ...employee, id, uid });
  return id;
}

export async function saveEmployee(employee) {
  const db = await getDB();
  return db.put('employees', employee);
}

export async function deleteEmployee(id) {
  const db = await getDB();
  return db.delete('employees', id);
}

/**
 * Import an employee from a remote source (e.g. EmployeeSync sheet),
 * preserving the existing UID instead of auto-generating one.
 */
export async function importEmployee({ uid, name, position, homeBranch, descriptors, createdAt }) {
  const db = await getDB();
  return db.add('employees', {
    uid:        uid        || '',
    name:       name       || '',
    position:   position   || '',
    homeBranch: homeBranch || '',
    descriptors: descriptors || [],
    createdAt:  createdAt  || new Date().toISOString(),
  });
}

/**
 * Merge remote employees (from EmployeeSync sheet) into local IndexedDB.
 * Rules:
 *   - Remote employee not in local  → import them (with or without face data)
 *   - Both exist, local has no face data, remote does → update local with remote descriptors
 *   - Both exist, local already has face data → keep local (authoritative for face)
 * Returns { added, updated } counts.
 */
export async function mergeEmployeesFromRemote(remoteEmps) {
  const local = await getAllEmployees();
  const localByUID = {};
  for (const emp of local) {
    if (emp.uid) localByUID[emp.uid] = emp;
  }

  let added = 0, updated = 0;
  for (const remote of remoteEmps) {
    if (!remote.uid) continue;
    const localEmp = localByUID[remote.uid];

    if (!localEmp) {
      await importEmployee(remote);
      added++;
    } else if (!(localEmp.descriptors?.length) && remote.descriptors?.length) {
      await saveEmployee({ ...localEmp, descriptors: remote.descriptors });
      updated++;
    }
  }
  return { added, updated };
}

// ── Attendance Logs ──────────────────────────────────────────────────────────

export function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getLogsByDate(date, branchCode) {
  const db = await getDB();
  const all = await db.getAllFromIndex('logs', 'date', date);
  if (branchCode) return all.filter((l) => l.branchCode === branchCode);
  return all;
}

export async function getLogsByEmployee(employeeId) {
  const db = await getDB();
  return db.getAllFromIndex('logs', 'employeeId', employeeId);
}

export async function getTodayLogForEmployee(employeeId) {
  const db = await getDB();
  const today = todayDateString();
  const results = await db.getAllFromIndex('logs', 'employeeDate', [employeeId, today]);
  return results[0] ?? null;
}

export async function saveLog(log) {
  const db = await getDB();
  return db.put('logs', log);
}

export async function addLog(log) {
  const db = await getDB();
  return db.add('logs', { ...log, date: log.date ?? todayDateString() });
}

export async function deleteLog(id) {
  const db = await getDB();
  return db.delete('logs', id);
}

export async function getAllLogs() {
  const db = await getDB();
  return db.getAll('logs');
}

/**
 * Clear cached session data on app startup:
 *   - Entire employees store (re-fetched fresh from Sheets after login)
 *   - All synced logs (already persisted in Sheets; keep unsynced for retry)
 * Called once before rendering routes so no stale biometric data sits on disk.
 */
export async function clearLocalCacheOnStartup() {
  const db = await getDB();
  await db.clear('employees');
  const tx = db.transaction('logs', 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (cursor.value.synced === true) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
