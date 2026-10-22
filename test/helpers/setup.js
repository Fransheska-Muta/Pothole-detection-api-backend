const os = require("os");
const path = require("path");

process.env.JWT_SECRET = "test-secret";
process.env.UPLOAD_DIR = path.join(os.tmpdir(), "pothole-test-uploads");
process.env.CLOUDINARY_URL = ""; // tests must never upload to the real Cloudinary