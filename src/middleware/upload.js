import multer from "multer";

/** Accept audio uploads in memory (no temp files on disk). */
export const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});
