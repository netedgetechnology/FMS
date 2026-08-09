export interface DatabaseHealth {
  connected: boolean;
  schemaVersion: number;
  databasePath: string;
  lastMigration?: string;
  sqliteVersion?: string;
}
