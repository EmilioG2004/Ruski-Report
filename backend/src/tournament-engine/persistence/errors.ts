export class EnginePersistenceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnginePersistenceConflictError";
  }
}

export class EnginePersistenceInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnginePersistenceInvariantError";
  }
}

export class EngineWriterLeaseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineWriterLeaseConflictError";
  }
}
