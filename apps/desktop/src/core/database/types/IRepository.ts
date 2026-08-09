export interface IRepository<T> {
  getAll(): Promise<T[]>;
  getById(id: number): Promise<T | null>;
  create(entity: T): Promise<number>;
  update(entity: T): Promise<void>;
  delete(id: number): Promise<void>;
}
