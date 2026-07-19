import { readFile } from 'node:fs/promises';
import { AppDatabaseStateSchema, type StorageResource } from '../lib/storageSchemas';
import { writeResource } from '../lib/s3Storage';

async function main() {
  const sourceFile = process.env.MIGRATION_SOURCE_FILE;
  if (!sourceFile) {
    throw new Error('MIGRATION_SOURCE_FILE is required; automatic seeding and implicit legacy reads are forbidden');
  }

  const raw = await readFile(sourceFile, 'utf8');
  const parsedJson: unknown = JSON.parse(raw);
  const parsed = AppDatabaseStateSchema.safeParse(parsedJson);
  if (!parsed.success) {
    console.error(JSON.stringify(parsed.error.issues, null, 2));
    throw new Error('Migration source failed validation; no object was written');
  }

  const state = parsed.data;
  const documents: Array<{ resource: StorageResource; data: unknown }> = [];
  for (const department of state.departments) {
    const departmentId = department.id;
    const data = state.deptData[departmentId];
    documents.push(
      { resource: { type: 'personnel', departmentId }, data: data.personnel },
      { resource: { type: 'requests', departmentId }, data: data.requests },
      {
        resource: { type: 'settings', departmentId },
        data: {
          activeYear: data.activeYear,
          settings_system: data.settings_system,
          settings_credentials: data.settings_credentials,
        },
      },
      { resource: { type: 'holidays', departmentId }, data: data.holidays },
      { resource: { type: 'firstDayOfWeek', departmentId }, data: data.firstDayOfWeek },
    );
    for (const [monthKey, schedule] of Object.entries(data.schedules)) {
      documents.push({ resource: { type: 'schedule', departmentId, monthKey }, data: schedule });
    }
  }

  // All writes are create-only. Existing keys cause a conflict rather than an overwrite.
  // The index is written last so partially migrated departments are never published.
  for (const document of documents) {
    await writeResource(document.resource, document.data, null);
    console.log(`created ${document.resource.type}`);
  }
  await writeResource({ type: 'departments' }, state.departments, null);
  console.log(`Migration completed: ${state.departments.length} departments, ${documents.length + 1} objects`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
