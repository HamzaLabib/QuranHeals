export class AppError extends Error {
  public readonly statusCode: number;
  public readonly expose: boolean;

  constructor(message: string, statusCode: number, expose = true) {
    super(message);
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

