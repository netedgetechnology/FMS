export interface IMigration {
  version: number;
  name: string;
  sql: string;
  seed?: boolean;
}
