const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const base64 = require("base-64");
const { chai, app, db, resetDb, createUser, tokenFor, bearer, basic } = require("./helpers/helpers");
const { expect } = chai;

describe("POST /signup", () => {
  beforeEach(resetDb);

  const validBody = () => ({
    name: "Mickey Mouse",
    email: "mickey@example.com",
    password: "securePass1",
    confirmPassword: "securePass1",
  });

  it("creates an account and returns 201 with the user and a JWT", async () => {
    const res = await chai.request(app).post("/signup").send(validBody());
    expect(res).to.have.status(201);
    expect(res).to.be.json;
    expect(res.body).to.include({ name: "Mickey Mouse", email: "mickey@example.com", role: "user" });
    expect(res.body.id).to.be.a("string").and.have.length(24);
    expect(res.body.token).to.be.a("string");
    expect(res.body).to.not.have.property("password");
  });

  it("returns a token containing the new user's id, email and their role", async () => {
    const res = await chai.request(app).post("/signup").send(validBody());
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded).to.include({ id: res.body.id, email: "mickey@example.com", role: "user" });
  });

  it("stores the password in base64-encoded but does not confirmPassword", async () => {
    await chai.request(app).post("/signup").send(validBody());
    const saved = await db.collection("users").findOne({ email: "mickey@example.com" });
    expect(saved.password).to.equal(base64.encode("securePass1"));
    expect(saved).to.not.have.property("confirmPassword");
  });

  it("ignores a role sent by the client if they are trying to promote themselves", async () => {
    const res = await chai.request(app).post("/signup").send({ ...validBody(), role: "superAdmin" });
    expect(res).to.have.status(201);
    expect(res.body.role).to.equal("user");
  });

  it("returns 400 when the name is missing", async () => {
    const { name, ...body } = validBody();
    const res = await chai.request(app).post("/signup").send(body);
    expect(res).to.have.status(400);
    expect(res.body.message).to.equal("Name is required");
  });

  it("returns 400 when the name is only spaces", async () => {
    const res = await chai.request(app).post("/signup").send({ ...validBody(), name: "   " });
    expect(res).to.have.status(400);
    expect(res.body.message).to.equal("Name is required");
  });

  it("returns 400 for an email without '@'", async () => {
    const res = await chai.request(app).post("/signup").send({ ...validBody(), email: "not-an-email" });
    expect(res).to.have.status(400);
    expect(res.body.message).to.equal("Invalid email format");
  });

  it("returns 400 for a password shorter than 8 characters", async () => {
    const res = await chai.request(app).post("/signup")
      .send({ ...validBody(), password: "short12", confirmPassword: "short12" });
    expect(res).to.have.status(400);
    expect(res.body.message).to.equal("Password must be at least 8 characters long");
  });

  it("accepts a password of exactly 8 characters (boundary)", async () => {
    const res = await chai.request(app).post("/signup")
      .send({ ...validBody(), password: "12345678", confirmPassword: "12345678" });
    expect(res).to.have.status(201);
  });

  it("returns 400 when the passwords do not match", async () => {
    const res = await chai.request(app).post("/signup").send({ ...validBody(), confirmPassword: "different1" });
    expect(res).to.have.status(400);
    expect(res.body.message).to.equal("Passwords do not match");
  });

  it("returns 400 for a duplicate email and does not create a second user", async () => {
    await createUser({ email: "mickey@example.com" });
    const res = await chai.request(app).post("/signup").send(validBody());
    expect(res).to.have.status(400);
    expect(res.body.message).to.equal("An account with this email already exists");
    expect(db.collection("users").docs).to.have.length(1);
  });
});

describe("POST /login", () => {
  beforeEach(resetDb);

  it("returns 200 with the user's details and a JWT for valid credentials", async () => {
    const user = await createUser({ name: "Mickey", email: "mickey@example.com", password: "password123", role: "municipality" });
    const res = await chai.request(app).post("/login").set("Authorization", basic("mickey@example.com", "password123"));
    expect(res).to.have.status(200);
    expect(res).to.be.json;
    expect(res.body).to.include({ name: "Mickey", email: "mickey@example.com", role: "municipality" });
    expect(res.body.id).to.equal(user.id);
    expect(res.body).to.not.have.property("password");
  });

  it("returns a token containing the user's id, email and role", async () => {
    const user = await createUser({ email: "mickey@example.com", role: "superAdmin" });
    const res = await chai.request(app).post("/login").set("Authorization", basic("mickey@example.com", "password123"));
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded).to.include({ id: user.id, email: "mickey@example.com", role: "superAdmin" });
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await chai.request(app).post("/login");
    expect(res).to.have.status(401);
    expect(res.body.message).to.equal("Missing or invalid Authorization header");
  });

  it("returns 401 when the header is Bearer instead of Basic", async () => {
    const res = await chai.request(app).post("/login").set("Authorization", "Bearer abc.def.ghi");
    expect(res).to.have.status(401);
    expect(res.body.message).to.equal("Missing or invalid Authorization header");
  });

  it("returns 401 'User not found' for an unknown email", async () => {
    const res = await chai.request(app).post("/login").set("Authorization", basic("ghost@example.com", "password123"));
    expect(res).to.have.status(401);
    expect(res.body.message).to.equal("User not found");
  });

  it("returns 401 'Invalid password' for a wrong password", async () => {
    await createUser({ email: "mickey@example.com", password: "password123" });
    const res = await chai.request(app).post("/login").set("Authorization", basic("mickey@example.com", "wrong-password"));
    expect(res).to.have.status(401);
    expect(res.body.message).to.equal("Invalid password");
    expect(res.body).to.not.have.property("token");
  });
});

describe("POST /locations", () => {
  let user, token;
  beforeEach(async () => {
    resetDb();
    user = await createUser({ email: "mickey@example.com" });
    token = tokenFor(user);
  });

  const post = (body) =>
    chai.request(app).post("/locations").set("Authorization", bearer(token)).send(body);

  it("saves the coordinates and returns 201", async () => {
    const res = await post({ latitude: -26.2041, longitude: 28.0473 });
    expect(res).to.have.status(201);
    expect(res.body.message).to.equal("Location submitted successfully");
  });

  it("stores the location in the loggedin user's id", async () => {
    await post({ latitude: -26.2041, longitude: 28.0473 });
    const saved = db.collection("locations").docs;
    expect(saved).to.have.lengthOf(1);
    expect(saved[0]).to.include({ userId: user.id, latitude: -26.2041, longitude: 28.0473 });
    expect(saved[0].createdAt).to.be.instanceOf(Date);
  });

  it(" takes in numbers in strings and stores them as normal numbers", async () => {
    const res = await post({ latitude: "-26.2041", longitude: "28.0473" });
    expect(res).to.have.status(201);
    expect(db.collection("locations").docs[0].latitude).to.equal(-26.2041);
  });

  it("accepts the range 90/180 and -90/-180", async () => {
    expect(await post({ latitude: 90, longitude: 180 })).to.have.status(201);
    expect(await post({ latitude: -90, longitude: -180 })).to.have.status(201);
  });

  it("returns 400 when latitude is missing", async () => {
    const res = await post({ longitude: 28.0473 });
    expect(res).to.have.status(400);
    expect(res.body.message).to.match(/required/i);
    expect(db.collection("locations").docs).to.have.lengthOf(0);
  });

  it("returns 400 when longitude is missing", async () => {
    const res = await post({ latitude: -26.2041 });
    expect(res).to.have.status(400);
  });

  it("returns 400 for non numeric coordinates", async () => {
    const res = await post({ latitude: "abc", longitude: "xyz" });
    expect(res).to.have.status(400);
  });

  it("returns 400 for out of range coordinates", async () => {
    const badLat = await post({ latitude: 91, longitude: 0 });
    const badLng = await post({ latitude: 0, longitude: -181 });
    expect(badLat).to.have.status(400);
    expect(badLat.body.message).to.match(/out of range/i);
    expect(badLng).to.have.status(400);
  });

  it("returns 401 without a token", async () => {
    const res = await chai.request(app).post("/locations").send({ latitude: 1, longitude: 1 });
    expect(res).to.have.status(401);
    expect(res.body.message).to.equal("No token provided");
  });

  it("returns 403 with an invalid token", async () => {
    const res = await chai.request(app).post("/locations")
      .set("Authorization", "Bearer not.a.jwt").send({ latitude: 1, longitude: 1 });
    expect(res).to.have.status(403);
    expect(res.body.message).to.equal("Invalid or expired token");
  });
});

describe("POST /report", () => {
  let user, token;
  beforeEach(async () => {
    resetDb()
    user = await createUser({ email: "reporter@example.com" });
    token = tokenFor(user);
  });

  after(() => {
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
  });

  function reportRequest({ omit = [], image = true } = {}) {
    const fields = {
      location: "Main Road, Johannesburg",
      latitude: "-26.2041",
      longitude: "28.0473",
      severity: "High",
      description: "Large pothole near the traffic light",
    };
    const req = chai.request(app).post("/report").set("Authorization", bearer(token));
    Object.entries(fields).forEach(([key, value]) => {
      if (!omit.includes(key)) req.field(key, value);
    })
    if (image) req.attach("image", Buffer.from("fake-image-bytes"), "pothole.jpg");
    return req
  }

  it("creates a report: 201, a reportId and the image name", async () => {
    const res = await reportRequest();
    expect(res).to.have.status(201);
    expect(res.body.message).to.equal("Thank you for your report");
    expect(res.body.reportId).to.be.a("string").and.have.length(24);
    expect(res.body.image).to.be.a("string").and.match(/\.jpg$/);
  });

  it("saves the uploaded image on disk", async () => {
    const res = await reportRequest();
    expect(fs.existsSync(path.join(process.env.UPLOAD_DIR, res.body.image))).to.be.true;
  });

  it("stores the report with status 'Pending', the user's id and the submitted fields", async () => {
    await reportRequest();
    const saved = db.collection("reports").docs;
    expect(saved).to.have.lengthOf(1);
    expect(saved[0]).to.include({
      userId: user.id,
      location: "Main Road, Johannesburg",
      severity: "High",
      description: "Large pothole near the traffic light",
      status: "Pending",
    });
    expect(saved[0].createdAt).to.be.instanceOf(Date);
  });

  ["location", "severity", "description"].forEach((field) => {
    it(`returns 400 when '${field}' is missing`, async () => {
      const res = await reportRequest({ omit: [field] });
      expect(res).to.have.status(400);
      expect(res.body.message).to.equal(`${field.charAt(0).toUpperCase() + field.slice(1)} is required`);
      expect(db.collection("reports").docs).to.have.lengthOf(0);
    });
  });

  it("returns 400 when the pothole image is missing", async () => {
    const res = await reportRequest({ image: false });
    expect(res).to.have.status(400);
    expect(res.body.message).to.equal("Pothole image is required");
    expect(db.collection("reports").docs).to.have.lengthOf(0);
  });

  it("returns 401 without a token", async () => {
    const res = await chai.request(app).post("/report").field("location", "x");
    expect(res).to.have.status(401);
  });
});