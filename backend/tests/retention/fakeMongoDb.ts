/**
 * A tiny in-memory stand-in for the MongoDB driver's Db/Collection, covering
 * exactly what services/MongoRetentionStores.ts uses: insertOne (with the
 * real duplicate-key error code 11000), findOne, find().sort().toArray(),
 * findOneAndUpdate, updateOne (including update pipelines and upsert, with
 * the server clock $$NOW taken from FakeDb.now), deleteOne, listIndexes, and
 * filters with equality, $lte, $gt, $ne and $expr comparisons against $$NOW. Documents are deep-copied in and out, like a
 * real database round trip, so state survives "restarts" (new store objects)
 * only through the fake itself.
 */
type Doc = Record<string, unknown>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function compare(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : (a as number | string);
  const bv = b instanceof Date ? b.getTime() : (b as number | string);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

let serverNow = () => new Date();

const MISSING = Symbol('missing');

/** Aggregation-expression subset: $$NOW, $field, $add, $cond, $or, $eq, $lte, $gt, $type ('missing' like MongoDB). */
function resolve(doc: Doc, value: unknown): unknown {
  if (value === '$$NOW') return serverNow();
  if (typeof value === 'string' && value.startsWith('$')) return value.slice(1) in doc ? doc[value.slice(1)] : MISSING;
  if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) {
    const [[op, raw]] = Object.entries(value as Doc);
    const args = Array.isArray(raw) ? raw : [raw];
    const at = (i: number) => resolve(doc, args[i]);
    switch (op) {
      case '$add': return new Date((at(0) as Date).getTime() + (at(1) as number));
      case '$cond': return at(0) ? at(1) : at(2);
      case '$or': return args.some((_, i) => Boolean(at(i)));
      case '$eq': return at(0) === at(1);
      case '$type': return at(0) === MISSING ? 'missing' : at(0) instanceof Date ? 'date' : typeof at(0);
      case '$lte': { const [l, r] = [at(0), at(1)]; return l !== MISSING && r !== MISSING && compare(l, r) <= 0; }
      case '$gt': { const [l, r] = [at(0), at(1)]; return l !== MISSING && r !== MISSING && compare(l, r) > 0; }
      default: throw new Error(`fake: unsupported expression ${op}`);
    }
  }
  return value;
}

function matchesExpr(doc: Doc, expr: Doc): boolean {
  return resolve(doc, expr) === true;
}

function applyUpdate(doc: Doc, update: { $set: Doc } | { $set: Doc }[]) {
  const stages = Array.isArray(update) ? update : [update];
  for (const stage of stages) {
    // Like a pipeline $set stage: every expression sees the document as it was before this stage.
    const input = { ...doc };
    for (const [key, value] of Object.entries(stage.$set)) {
      const next = Array.isArray(update) ? resolve(input, value) : clone(value);
      if (next === MISSING) delete doc[key];
      else doc[key] = next;
    }
  }
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$expr') return matchesExpr(doc, condition as Doc);
    const value = doc[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      return Object.entries(condition as Doc).every(([op, operand]) => {
        if (op === '$lte') return value !== undefined && compare(value, operand) <= 0;
        if (op === '$gt') return value !== undefined && compare(value, operand) > 0;
        if (op === '$ne') return value !== operand;
        throw new Error(`fake: unsupported operator ${op}`);
      });
    }
    return condition instanceof Date ? value instanceof Date && value.getTime() === condition.getTime() : value === condition;
  });
}

export class FakeCollection {
  docs: Doc[] = [];
  indexes: Doc[] = [{ key: { _id: 1 }, name: '_id_' }];
  failNext: Partial<Record<'find' | 'insert', Error>> = {};

  async insertOne(doc: Doc) {
    if (this.failNext.insert) {
      const error = this.failNext.insert;
      delete this.failNext.insert;
      throw error;
    }
    const copy = clone(doc);
    if (copy._id === undefined) copy._id = `auto-${this.docs.length + 1}-${Math.random()}`;
    if (this.docs.some((existing) => existing._id === copy._id)) throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    this.docs.push(copy);
    return { insertedId: copy._id };
  }

  async findOne(filter: Doc = {}) {
    const found = this.docs.find((doc) => matches(doc, filter));
    return found ? clone(found) : null;
  }

  find(filter: Doc = {}, options: { projection?: Doc } = {}) {
    if (this.failNext.find) {
      const error = this.failNext.find;
      delete this.failNext.find;
      return { sort: () => ({ toArray: async () => Promise.reject(error) }), toArray: async () => Promise.reject(error) };
    }
    let results = this.docs.filter((doc) => matches(doc, filter)).map((doc) => clone(doc));
    const project = (doc: Doc) => {
      if (!options.projection) return doc;
      for (const [key, include] of Object.entries(options.projection)) if (include === 0) delete doc[key];
      return doc;
    };
    const api = {
      sort: (spec: Doc) => {
        const [[key, direction]] = Object.entries(spec) as [string, number][];
        results = [...results].sort((a, b) => compare(a[key], b[key]) * direction);
        return api;
      },
      toArray: async () => results.map(project),
    };
    return api;
  }

  async findOneAndUpdate(filter: Doc, update: { $set: Doc }) {
    const doc = this.docs.find((candidate) => matches(candidate, filter));
    if (!doc) return null;
    Object.assign(doc, clone(update.$set));
    return clone(doc);
  }

  async updateOne(filter: Doc, update: { $set: Doc } | { $set: Doc }[], options: { upsert?: boolean } = {}) {
    const doc = this.docs.find((candidate) => matches(candidate, filter));
    if (doc) {
      applyUpdate(doc, update);
      return { matchedCount: 1, modifiedCount: 1 };
    }
    if (options.upsert) {
      if ('$expr' in filter) throw Object.assign(new Error('$expr is not allowed in the query predicate for an upsert'), { code: 2 });
      // Like MongoDB: the new document starts from the filter's plain equality fields.
      const seed = Object.fromEntries(Object.entries(filter).filter(([key, value]) => !key.startsWith('$') && !(value && typeof value === 'object' && !(value instanceof Date))));
      if (this.docs.some((existing) => existing._id === seed._id)) throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
      const created = clone(seed);
      applyUpdate(created, update);
      this.docs.push(created);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    return { matchedCount: 0, modifiedCount: 0 };
  }

  async deleteOne(filter: Doc) {
    const index = this.docs.findIndex((doc) => matches(doc, filter));
    if (index < 0) return { deletedCount: 0 };
    this.docs.splice(index, 1);
    return { deletedCount: 1 };
  }

  listIndexes() {
    return { toArray: async () => clone(this.indexes) };
  }
}

export class FakeDb {
  readonly collections = new Map<string, FakeCollection>();
  /** The fake server clock used for $$NOW. */
  now = new Date();

  constructor() {
    serverNow = () => new Date(this.now.getTime());
  }

  collection(name: string): FakeCollection {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection());
    return this.collections.get(name)!;
  }
}
