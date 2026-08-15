require("dotenv").config();
const cors = require("cors");
const express = require("express");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
app.use(express.json());

// MongoDB connection setup  
const uri = process.env.MONGODB_URI;
const { MongoClient, ObjectId} = require("mongodb");
const base64 = require("base-64");
let client;
let db;

// Function to connect to MongoDB
async function connectToDatabase() {
  // console.log(uri)
  client = new MongoClient("mongodb://mutafransheska45_db_user:CreateaPassword@ac-2knek11-shard-00-00.r0hpfpp.mongodb.net:27017,ac-2knek11-shard-00-01.r0hpfpp.mongodb.net:27017,ac-2knek11-shard-00-02.r0hpfpp.mongodb.net:27017/?ssl=true&replicaSet=atlas-wznptk-shard-0&authSource=admin&appName=Cluster0"); 
  await client.connect();
  db = client.db("PotholeDetection");
}

// Middleware for Basic Authentication
async function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return res.status(401)
    .json({ message: "Missing or invalid Authorization header" });
  }

  // Split the credentials into user/password
  const base64Credentials = authHeader.split(" ")[1];
  const credentials = base64.decode(base64Credentials).split(":");
  const email = credentials[0];
  const password = credentials[1];

  // Read MongoDB
  const collection = db.collection("users");
  const user = await collection.findOne({ email });

  // if user not found
  if (!user) {
    return res.status(401).json({ message: "User not found" });
  }

  // Decode and check the password
  const decodeStoredPassword = base64.decode(user.password);
  if (decodeStoredPassword !== password) {
    return res.status(401).json({ message: "Invalid password" });
  }
  req.user = user;
  next();
}

// Endpoint to handle user signup
app.post("/signup", async (req, res) => {
  try{
    const user = req.body;
  // validate user input
  if(user.password.length < 8)
    throw new Error("Password must be at least 8 characters long");
  if(!user.email.includes("@"))
    throw new Error("Invalid email format");
  if(user.password !== user.confirmPassword)
    throw new Error("Passwords do not match");
  
  // remove confirmPassword field before storing in database
  delete user.confirmPassword;
  
  // Every users starts as a normal user
  user.role = "user";

  // encode password before storing, it means hiding the password before stroing it
  user.password = base64.encode(user.password);

  // add user to database
  const collection = db.collection("users");
  const result = await collection.insertOne({
    ...user,
    createdAt: new Date(),
  });

  res.status(201).json({
    message: "Account created successfully",
    userId: result.insertedId,
  });
}catch(error) {
    console.error(error);
    res.status(400).json({
    message: error.message
  });
}
});

// Jwt middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({
          message: "No token provided"
        });
    }
    const token = authHeader.split(" ")[1];
    if (!token) {
        return res.status(401).json({
            message: "Invalid token"
        });
    }
    try {
        const decoded = jwt.verify(
          token,
          process.env.JWT_SECRET
        );

        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({
            message: "Invalid or expired token"
        });
    }
}

app.post("/login",basicAuth, async (req, res) => {
  const token = jwt.sign({
    id: req.user._id,
    email: req.user.email,
    role: req.user.role
  },
    process.env.JWT_SECRET,
    {
      expiresIn: "1h"
    }
)
    res.json({
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        token: token
    });
});

app.use(authenticateToken)

// tHis is so that the superadmin can see all users but their password is removed for safety
app.get("/users", async (req, res) => {
    try {
        if (req.user.role !== "superAdmin") {
          return res.status(403).json({
          message: "Access Denied"
        });
      }
        const collection = db.collection("users");
        const users = await collection.find({role: {$in: ["municipality"]}},
        {projection: {
          name: 1,
          email: 1,
          role: 1
        }}).toArray();
      res.json(users)
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({
      message: "Internal Server Error"
    });
  }
});

// so that the superadmin can promote users
app.put("/users/promote", async (req, res) => {
    try {
        //only the SuperAdmin can promote users
        if (req.user.role !== "superAdmin") {
          return res.status(403).json({
            message: "Access Denied"
          });
        }
        const { email, role } = req.body;
        // the email is required
        if (!email) { 
          return res.status(400).json({ message: "Email is required"})
        }
        // the promotion role is required
        if (!role) {
          return res.status(400).json({message: "Role is required"});
        }

        //the role options
        const allowedRoles = ["user","municipality"];
        if (!allowedRoles.includes(role)) {
            return res.status(400).json({
            message: "Invalid role"
    });
}
  const collection = db.collection("users");
    //searching for the user by their email
    const user = await collection.findOne({email: email});
    if (!user) {
        return res.status(404).json({
        message: "User not found"
      });
    }
      //changnig their role
      const result = await collection.updateOne({email: email},
            {$set: {
              role: role
            }
        }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({
      message: "User not found"
    });
  }
    res.json({message: "User promoted successfully",
      user: { 
        id: user._id,
        name: user.name,
        email: user.email,
        role: role}
  });
    } catch (error) {
        console.error("Error promoting user:", error);
        res.status(500).json({
        message: "Internal Server Error"
      });
    }
});

// Endpoint to post location
app.post("/locations", async (req, res) => {
    try {
        const { latitude, longitude } = req.body;
        const collection = db.collection("locations");
        const result = await collection.insertOne({
            userId: req.user._id,
            latitude,
            longitude,
            createdAt: new Date(),
        });
        res.status(201).json({ message: "Location submitted successfully" });
    } catch (error) {
        console.error("Error submitting location: ", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

//Endpoint to get locations
app.get("/locations", async (req, res) => {
    try {
        const {userId} = req.query;
        const collection = db.collection("locations");
        const locations = await collection.find({ userId: req.user._id }).toArray();
        res.json(locations);
    } catch (error) {
        console.error("Error fetching locations: ", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// Endpoint to post report
app.post("/report", async (req, res) => {
    try {
        const { location, severity, description } = req.body;
        const collection = db.collection("reports");
        const result = await collection.insertOne({
            userId: req.user._id,
            location,
            severity,
            description,
            createdAt: new Date(),
        });
        res.status(201).json({ message: "Thank you for your report" });
    } catch (error) {
        console.error("Error submitting report: ", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});


//Endpoint to get reports
app.get("/report", async (req, res) => {
    try {
        const collection = db.collection("reports");
        const reports = await collection.find({ userId: req.user._id }).toArray();
        res.json(reports);
    } catch (error) {
        console.error("Error fetching reports: ", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

//Endpoint to get geocode data from OpenStreetMap Nominatim API
app.get("/geocode", async (req, res) => {
  try {
    const { address } = req.query;

    if (!address) {
      return res.status(400).json({ message: "Address is required" });
    }

    const response = await axios.get(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json`,
      {
        headers: {
          "User-Agent": "pothole-detection-app"
        }
      }
    );  

    if (response.data.length === 0) {
      return res.status(404).json({ message: "Location not found" });
    }

    const place = response.data[0];

    res.json({
      latitude: place.lat,
      longitude: place.lon,
      name: place.display_name
    });
    console.log(" openstreetmap is in use");

  } catch (error) {
    console.error("Error fetching geocode data:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


app.listen(PORT, async () => {
  await connectToDatabase();
  console.log(`Server is running on port ${PORT}`);
});
