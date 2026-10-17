const { ObjectId } = require("mongodb");

const match = (doc, q = {}) =>
  Object.entries(q).every(([k, c]) =>
    c && c.$in ? c.$in.includes(doc[k]) : doc[k] === c
  );

class Col {
  constructor() { this.docs = []; }

  async findOne(q) {
    const d = this.docs.find((x) => match(x, q));
    return d ? { ...d } : null;
  }

  find(q, opts = {}) {
    let r = this.docs.filter((x) => match(x, q));
    const cur = {
      sort: (s) => {
        const [[k, dir]] = Object.entries(s);
        r = [...r].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
        return cur;
      },
      toArray: async () =>
        r.map((d) => {
          if (!opts.projection) return { ...d };
          const o = { _id: d._id };
          Object.keys(opts.projection).forEach((f) => { if (f in d) o[f] = d[f]; });
          return o;
        }),
    };
    return cur;
  }

  async insertOne(doc) {
    const s = { _id: new ObjectId(), ...doc };
    this.docs.push(s);
    return { insertedId: s._id };
  }

  async updateOne(q, u) {
    const d = this.docs.find((x) => match(x, q));
    if (!d) return { matchedCount: 0 };
    Object.assign(d, u.$set);
    return { matchedCount: 1 };
  }
}

class FakeDb {
  constructor() { this.c = {}; }
  collection(n) { return this.c[n] || (this.c[n] = new Col()); }
  reset() { this.c = {}; }
}

module.exports = { FakeDb };