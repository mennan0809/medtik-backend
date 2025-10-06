const multer = require("multer");
const path = require("path");
const fs = require("fs");

// save files in project-root/uploads
const uploadPath = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadPath),
    filename: (req, file, cb) => {
        // make filename safe
        const safeName = file.originalname.replace(/\s+/g, "_");
        cb(null, `${Date.now()}-${safeName}`);
    }
});

const upload = multer({ storage });
module.exports = upload;
