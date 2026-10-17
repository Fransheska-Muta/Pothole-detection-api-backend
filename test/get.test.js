const jwt = require("jsonwebtoken");
const axios = require("axios");
const { chai, app, db, resetDb, createUser, tokenFor, bearer } = require("./helpers/helpers");
const { expect } = chai;

//  get users
describe("GET /users", () => {
  let superAdmin;
  beforeEach(async () => {
    resetDb();
    superAdmin = await createUser({ name: "Admin", email: "admin@example.com", role: "superAdmin" });
    await createUser({ name: "Muni", email: "muni@example.com", role: "municipality" });
    await createUser({ name: "Regular", email: "regular@example.com", role: "user" });
  });

  it("returns 200 and only municipality and superAdmin accounts to a superAdmin", async () => {
    const res = await chai.request(app).get("/users").set("Authorization", bearer(tokenFor(superAdmin)));
    expect(res).to.have.status(200);
    expect(res).to.be.json;
    expect(res.body).to.be.an("array").with.lengthOf(2);
    expect(res.body.map((u) => u.role)).to.have.members(["superAdmin", "municipality"]);
    expect(res.body.map((u) => u.email)).to.not.include("regular@example.com");
  });

  it("only exposes _id, name, email and role (never the password)", async () => {
    const res = await chai.request(app).get("/users").set("Authorization", bearer(tokenFor(superAdmin)));
    res.body.forEach((u) => {
      expect(u).to.have.all.keys("_id", "name", "email", "role");
      expect(u).to.not.have.property("password");
    });
  });

  it("returns 403 'Access Denied' for a normal user", async () => {
    const user = await createUser({ email: "someone@example.com", role: "user" });
    const res = await chai.request(app).get("/users").set("Authorization", bearer(tokenFor(user)));
    expect(res).to.have.status(403);
    expect(res.body.message).to.equal("Access Denied");
  });

  it("returns 403 'Access Denied' for a municipality user", async () => {
    const muni = await createUser({ email: "muni2@example.com", role: "municipality" });
    const res = await chai.request(app).get("/users").set("Authorization", bearer(tokenFor(muni)));
    expect(res).to.have.status(403);
    expect(res.body.message).to.equal("Access Denied");
  });

  it("returns 401 when no token is provided", async () => {
    const res = await chai.request(app).get("/users");
    expect(res).to.have.status(401);
    expect(res.body.message).to.equal("No token provided");
  });
});

// get locations
describe("GET /locations", () => {
  let alice, bob;
  beforeEach(async () => {
    resetDb();
    alice = await createUser({ email: "alice@example.com" });
    bob = await createUser({ email: "bob@example.com" });
    await db.collection("locations").insertOne({ userId: alice.id, latitude: 1, longitude: 2 });
    await db.collection("locations").insertOne({ userId: alice.id, latitude: 3, longitude: 4 });
    await db.collection("locations").insertOne({ userId: bob.id, latitude: 5, longitude: 6 });
  });

  it("returns 200 and only the logged-in user's locations", async () => {
    const res = await chai.request(app).get("/locations").set("Authorization", bearer(tokenFor(alice)));
    expect(res).to.have.status(200);
    expect(res).to.be.json;
    expect(res.body).to.be.an("array").with.lengthOf(2);
    res.body.forEach((loc) => expect(loc.userId).to.equal(alice.id));
  });

  it("does not leak another user's locations", async () => {
    const res = await chai.request(app).get("/locations").set("Authorization", bearer(tokenFor(bob)));
    expect(res.body).to.have.lengthOf(1);
    expect(res.body[0]).to.include({ latitude: 5, longitude: 6 });
  });

  it("returns an empty array for a user with no saved locations", async () => {
    const newUser = await createUser({ email: "new@example.com" });
    const res = await chai.request(app).get("/locations").set("Authorization", bearer(tokenFor(newUser)));
    expect(res).to.have.status(200);
    expect(res.body).to.be.an("array").that.is.empty;
  });

  it("returns 401 without a token", async () => {
    const res = await chai.request(app).get("/locations");
    expect(res).to.have.status(401);
  });
});

//  get reports
describe("GET /reports", () => {
  let user;
  beforeEach(async () => {
    resetDb();
    user = await createUser({ email: "viewer@example.com" });
    const reports = db.collection("reports");
    await reports.insertOne({ location: "Oldest", status: "Resolved", createdAt: new Date("2026-01-01") });
    await reports.insertOne({ location: "Newest", status: "Pending", createdAt: new Date("2026-03-01") });
    await reports.insertOne({ location: "Middle", status: "In Progress", createdAt: new Date("2026-02-01") });
  });

  it("returns 200 and every report as a JSON array", async () => {
    const res = await chai.request(app).get("/reports").set("Authorization", bearer(tokenFor(user)));
    expect(res).to.have.status(200);
    expect(res).to.be.json;
    expect(res.body).to.be.an("array").with.lengthOf(3);
  });

  it("sorts the reports newest first", async () => {
    const res = await chai.request(app).get("/reports").set("Authorization", bearer(tokenFor(user)));
    expect(res.body.map((r) => r.location)).to.deep.equal(["Newest", "Middle", "Oldest"]);
  });

  it("returns an empty array when there are no reports", async () => {
    db.collection("reports").docs = [];
    const res = await chai.request(app).get("/reports").set("Authorization", bearer(tokenFor(user)));
    expect(res).to.have.status(200);
    expect(res.body).to.be.an("array").that.is.empty;
  });

  it("returns 401 without a token", async () => {
    const res = await chai.request(app).get("/reports");
    expect(res).to.have.status(401);
  });
});

//  get municipality/reports
describe("GET /municipality/reports", () => {
  beforeEach(async () => {
    resetDb();
    const reports = db.collection("reports");
    await reports.insertOne({ location: "A", createdAt: new Date("2026-01-01") });
    await reports.insertOne({ location: "B", createdAt: new Date("2026-02-01") });
  });

  it("returns 200 and the reports (newest first) for a municipality user", async () => {
    const muni = await createUser({ email: "muni@example.com", role: "municipality" });
    const res = await chai.request(app).get("/municipality/reports").set("Authorization", bearer(tokenFor(muni)));
    expect(res).to.have.status(200);
    expect(res.body.map((r) => r.location)).to.deep.equal(["B", "A"]);
  });

  it("returns 200 for a superAdmin", async () => {
    const admin = await createUser({ email: "admin@example.com", role: "superAdmin" });
    const res = await chai.request(app).get("/municipality/reports").set("Authorization", bearer(tokenFor(admin)));
    expect(res).to.have.status(200);
    expect(res.body).to.have.lengthOf(2);
  });

  it("returns 403 'Access Denied' for a normal user", async () => {
    const user = await createUser({ email: "plain@example.com", role: "user" });
    const res = await chai.request(app).get("/municipality/reports").set("Authorization", bearer(tokenFor(user)));
    expect(res).to.have.status(403);
    expect(res.body.message).to.equal("Access Denied");
  });

  it("returns 401 without a token", async () => {
    const res = await chai.request(app).get("/municipality/reports");
    expect(res).to.have.status(401);
  });
});

// validing the users
describe("JWT authentication on protected GET endpoints", () => {
  let user;
  beforeEach(async () => {
    resetDb();
    user = await createUser({ email: "jwt@example.com" });
  });

  it("accepts a valid token", async () => {
    const res = await chai.request(app).get("/reports").set("Authorization", bearer(tokenFor(user)));
    expect(res).to.have.status(200);
  });

  it("returns 401 'No token provided' when the Authorization header is absent", async () => {
    const res = await chai.request(app).get("/reports");
    expect(res).to.have.status(401);
    expect(res.body.message).to.equal("No token provided");
  });

  it("returns 401 'Invalid token' when the header has no token part", async () => {
    const res = await chai.request(app).get("/reports").set("Authorization", "Bearer");
    expect(res).to.have.status(401);
    expect(res.body.message).to.equal("Invalid token");
  });

  it("returns 403 for a malformed token", async () => {
    const res = await chai.request(app).get("/reports").set("Authorization", "Bearer not.a.jwt");
    expect(res).to.have.status(403);
    expect(res.body.message).to.equal("Invalid or expired token");
  });

  it("returns 403 for a token signed with the wrong secret", async () => {
    const forged = jwt.sign({ id: user.id, email: user.email, role: "superAdmin" }, "some-other-secret");
    const res = await chai.request(app).get("/reports").set("Authorization", bearer(forged));
    expect(res).to.have.status(403);
  });

  it("returns 403 for an expired token", async () => {
    const expired = tokenFor(user, { expiresIn: -60 });
    const res = await chai.request(app).get("/reports").set("Authorization", bearer(expired));
    expect(res).to.have.status(403);
    expect(res.body.message).to.equal("Invalid or expired token");
  });

  it("returns 404 for an unknown route when authenticated", async () => {
    const res = await chai.request(app).get("/does-not-exist").set("Authorization", bearer(tokenFor(user)));
    expect(res).to.have.status(404);
  });
});

// geocode endpoints
describe("Geocoding endpoints", () => {
  let token;
  let originalGet;
  let calls;

  before(() => { originalGet = axios.get; });
  beforeEach(async () => {
    resetDb();
    token = tokenFor(await createUser({ email: "mickey@example.com" }));
    calls = [];
  });
  afterEach(() => { axios.get = originalGet; });

  // Replaces axios.get with a fake that records its arguments and returns `data`.
  function stubAxios(data) {
    axios.get = async (...args) => {
      calls.push(args);
      return { data };
    };
  }

  describe("GET /geocode", () => {
    it("returns 200 with latitude, longitude and name of the first match", async () => {
      stubAxios([
        { lat: "-26.2041", lon: "28.0473", display_name: "Johannesburg, South Africa" },
        { lat: "0", lon: "0", display_name: "Second result is ignored" },
      ]);
      const res = await chai.request(app).get("/geocode").query({ address: "Johannesburg" }).set("Authorization", bearer(token));
      expect(res).to.have.status(200);
      expect(res.body).to.deep.equal({ latitude: "-26.2041", longitude: "28.0473", name: "Johannesburg, South Africa" });
    });

    it("sends the URL-encoded address and a User-Agent header to Nominatim", async () => {
      stubAxios([{ lat: "1", lon: "2", display_name: "x" }]);
      await chai.request(app).get("/geocode").query({ address: "12 Main Rd & 3rd St" }).set("Authorization", bearer(token));
      expect(calls).to.have.lengthOf(1);
      expect(calls[0][0]).to.include("q=12%20Main%20Rd%20%26%203rd%20St");
      expect(calls[0][1].headers["User-Agent"]).to.equal("pothole-detection-app");
    });

    it("returns 400 when the address is missing and does not call the external service", async () => {
      stubAxios([]);
      const res = await chai.request(app).get("/geocode").set("Authorization", bearer(token));
      expect(res).to.have.status(400);
      expect(res.body.message).to.equal("Address is required");
      expect(calls).to.have.lengthOf(0);
    });

    it("returns 400 when the address is an empty string", async () => {
      stubAxios([]);
      const res = await chai.request(app).get("/geocode").query({ address: "" }).set("Authorization", bearer(token));
      expect(res).to.have.status(400);
    });

    it("returns 404 'Location not found' when there are no matches", async () => {
      stubAxios([]);
      const res = await chai.request(app).get("/geocode").query({ address: "zzzzzz" }).set("Authorization", bearer(token));
      expect(res).to.have.status(404);
      expect(res.body.message).to.equal("Location not found");
    });

    it("returns 500 when the external service fails", async () => {
      axios.get = async () => { throw new Error("network down"); };
      const res = await chai.request(app).get("/geocode").query({ address: "Johannesburg" }).set("Authorization", bearer(token));
      expect(res).to.have.status(500);
      expect(res.body.message).to.equal("Internal Server Error");
    });

    it("returns 401 without a token", async () => {
      const res = await chai.request(app).get("/geocode").query({ address: "Johannesburg" });
      expect(res).to.have.status(401);
    });
  });

  describe("GET /geocode/suggestions", () => {
    it("returns 200 with a list of {name, latitude, longitude} suggestions", async () => {
      stubAxios([
        { display_name: "Sandton, Johannesburg", lat: "-26.1076", lon: "28.0567", extra: "dropped" },
        { display_name: "Soweto, Johannesburg", lat: "-26.2485", lon: "27.8540" },
      ]);
      const res = await chai.request(app).get("/geocode/suggestions").query({ address: "S" }).set("Authorization", bearer(token));
      expect(res).to.have.status(200);
      expect(res.body).to.deep.equal([
        { name: "Sandton, Johannesburg", latitude: "-26.1076", longitude: "28.0567" },
        { name: "Soweto, Johannesburg", latitude: "-26.2485", longitude: "27.8540" },
      ]);
    });

    it("asks Nominatim for at most 5 results using the given address", async () => {
      stubAxios([]);
      await chai.request(app).get("/geocode/suggestions").query({ address: "Cape" }).set("Authorization", bearer(token));
      expect(calls[0][1].params).to.deep.equal({ q: "Cape", format: "json", limit: 5 });
    });

    it("returns 200 and an empty array when nothing matches", async () => {
      stubAxios([]);
      const res = await chai.request(app).get("/geocode/suggestions").query({ address: "zzzz" }).set("Authorization", bearer(token));
      expect(res).to.have.status(200);
      expect(res.body).to.be.an("array").that.is.empty;
    });

    it("returns 400 when the address is missing", async () => {
      stubAxios([]);
      const res = await chai.request(app).get("/geocode/suggestions").set("Authorization", bearer(token));
      expect(res).to.have.status(400);
      expect(res.body.message).to.equal("Address is required");
      expect(calls).to.have.lengthOf(0);
    });

    it("returns 500 'Unable to get location suggestions' when the external service fails", async () => {
      axios.get = async () => { throw new Error("timeout"); };
      const res = await chai.request(app).get("/geocode/suggestions").query({ address: "Cape" }).set("Authorization", bearer(token));
      expect(res).to.have.status(500);
      expect(res.body.message).to.equal("Unable to get location suggestions");
    });

    it("returns 401 without a token", async () => {
      const res = await chai.request(app).get("/geocode/suggestions").query({ address: "Cape" });
      expect(res).to.have.status(401);
    });
  });
});