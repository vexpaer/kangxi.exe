export class DurableObject<E = unknown> {
  protected ctx: unknown;
  protected env: E;
  constructor(ctx: unknown, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}
