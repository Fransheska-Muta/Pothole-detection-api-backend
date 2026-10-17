const jwt = require("jsonwebtoken");
const base64 = require("base-64");
const chai = require("chai");
const chaiHttp = require("chai-http");
const { app, setDb } = require("../../index");
const { FakeDb } = require("./fakeDb");

chai.use(chaiHttp);

const db = new FakeDb();
setDb(db);

const resetDb = () => db.reset();

async function createUser({ name = "Test", email = "user@example.com", password = "password123", role = "user" } = {}) {
  const r = await db.collection("users").insertOne({
    name, email, password: base64.encode(password), role,
  });
  return { id: r.insertedId.toString(), email, role };
}

const tokenFor = (u, opts = { expiresIn: "1h" }) =>
  jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, opts);

const bearer = (t) => `Bearer ${t}`;
const basic = (e, p) => "Basic " + Buffer.from(`${e}:${p}`).toString("base64");

module.exports = { chai, app, db, resetDb, createUser, tokenFor, bearer, basic };