import fs from "fs";
import path from "path";
import sharp from "sharp";

export function getImageMimeType(imagePath: string): string {
  const ext = path.extname(imagePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    default:
      return "image/png";
  }
}

export async function prepareImageForLlm(
  absPath: string,
  imagePath: string,
): Promise<{ mimeType: string; data: Buffer }> {
  const file = fs.readFileSync(absPath);
  const ext = path.extname(imagePath).toLowerCase();

  if (ext === ".webp") {
    return {
      mimeType: "image/png",
      data: await sharp(file).png().toBuffer(),
    };
  }

  return {
    mimeType: getImageMimeType(imagePath),
    data: file,
  };
}
