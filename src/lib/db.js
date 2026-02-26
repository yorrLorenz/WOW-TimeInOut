import { openDB } from 'idb';

const DB_NAME = 'timeinout-db';
const DB_VERSION = 3;

const DEFAULT_BRANCHES = [
  { code: 'MAIN-001', name: 'Main Branch', pin: '1234' },
  { code: 'NORTH-002', name: 'North Branch', pin: '1234' },
  { code: 'SOUTH-003', name: 'South Branch', pin: '1234' },
];

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

        // ── Seed default branches + SUPER-ADMIN ──────────────────────────
        const branchStore = transaction.objectStore('branches');
        for (const b of DEFAULT_BRANCHES) {
          const existing = await branchStore.get(b.code);
          if (!existing) await branchStore.add(b);
        }
        const adminExisting = await branchStore.get('SUPER-ADMIN');
        if (!adminExisting) {
          await branchStore.add({
            code: 'SUPER-ADMIN',
            name: 'Super Admin',
            pin: 'admin1234',
            isAdmin: true,
          });
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

// ── Attendance Logs ──────────────────────────────────────────────────────────

export function todayDateString() {
  return new Date().toISOString().slice(0, 10);
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
