/**
 * Student verification document upload (ID card / admission letter).
 *
 * Written to backend/uploads/student-docs/, which nothing in server.js's
 * express.static ever mounts (only frontend/ is served) — a document is
 * reachable only through the admin-authenticated streaming route in
 * routes/admin.js, never by a guessable public URL.
 *
 * FTP deploys sync from the git checkout and never touch a directory that
 * was never part of it, so files written here survive redeploys the same
 * way backend/.env does (see the "FTP flag that deletes .env" memory) — as
 * long as dangerous-clean-slate stays off.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_ROOT = process.env.STUDENT_DOC_DIR || path.join(__dirname, '..', 'uploads', 'student-docs');
const MAX_BYTES = 8 * 1024 * 1024; // 8MB — a phone photo of an ID card fits comfortably under this
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(UPLOAD_ROOT, String(req.user.id));
    fs.mkdir(dir, { recursive: true, mode: 0o700 }, err => cb(err, dir));
  },
  filename(req, file, cb) {
    const name = crypto.randomBytes(16).toString('hex') + (EXT_BY_MIME[file.mimetype] || '');
    cb(null, name);
  },
});

const studentDocUpload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    cb(null, ALLOWED_MIME.has(file.mimetype));
  },
}).single('document');

/** Returns the path to store in the DB — relative to UPLOAD_ROOT, never the absolute host path. */
function relativePath(req) {
  return path.join(String(req.user.id), req.file.filename);
}

function absolutePath(relPath) {
  return path.join(UPLOAD_ROOT, relPath);
}

module.exports = { studentDocUpload, relativePath, absolutePath, UPLOAD_ROOT, MAX_BYTES };
