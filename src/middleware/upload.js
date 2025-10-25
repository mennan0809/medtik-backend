// src/middleware/upload.js
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Define absolute uploads path
const uploadPath = path.resolve(process.cwd(), 'uploads');

// Make sure the folder exists
if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
    console.log('✅ Uploads folder created at:', uploadPath);
} else {
    console.log('✅ Uploads folder exists at:', uploadPath);
}

// Multer storage config
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadPath),
    filename: (req, file, cb) => {
        // make filename safe
        const safeName = file.originalname.replace(/\s+/g, "_");
        cb(null, `${Date.now()}-${safeName}`);
    }
});

// Multer instance
const upload = multer({ storage });

module.exports = upload;
