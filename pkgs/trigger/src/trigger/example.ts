import { logger, task, usage } from "@trigger.dev/sdk/v3";
import { S3Client, ObjectCannedACL } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';


export interface OptimizeImageInputLocal {
  type: 'local';
  file_path: string;
}

export interface OptimizeImageInputRemote {
  type: 'remote';
  file_url: string;
}

export interface OptimizeImageDestination {
  bucket_name: string;
  object_folder: string;
  object_slug: string;
}

export type OptimizeImageInput = {
  source: OptimizeImageInputLocal | OptimizeImageInputRemote;
  dest: OptimizeImageDestination;
}

export interface OptimizeImageOutput {
  optimized_img_url: string;
}

/**
 * Download an image from a remote URL.
 *
 * @param url - The URL of the image to download
 * @returns A Buffer containing the image data
 * @throws Will throw an error if the download fails
 */
async function download_image(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image from ${url}: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Upload an image file to DigitalOcean Spaces.
 *
 * @param filePath - Path to the image file to upload
 * @param bucketName - Name of the Space (bucket)
 * @param objectFolder - Folder within the Space to store the object
 * @param objectSlug - Slug to prefix the uploaded file
 * @returns The CDN URL of the uploaded image
 * @throws Will throw an error if upload fails
 */
export async function upload_image_to_digital_ocean_spaces(input: OptimizeImageInput): Promise<OptimizeImageOutput> {
  // Load environment variables
  const ACCESS_KEY = process.env.DIGITAL_OCEAN_SPACES_ACCESS_KEY;
  const SECRET_KEY = process.env.DIGITAL_OCEAN_SPACES_SECRET_KEY;
  const REGION = 'nyc3';
  const ENDPOINT = `https://${REGION}.digitaloceanspaces.com`;

  if (!ACCESS_KEY || !SECRET_KEY) {
    throw new Error('DigitalOcean Spaces credentials are not set in environment variables.');
  }

  // Configure AWS SDK for DigitalOcean Spaces
  const s3Client = new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    credentials: {
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    },
    // Disable AWS-specific features
    forcePathStyle: true, // DigitalOcean requires path-style URLs
  });

  // Generate a unique filename
  const fileExtension = 'avif';
  const fileNameBase = `${input.dest.object_slug}-${uuidv4()}`;
  const avifFileName = `${fileNameBase}.${fileExtension}`;
  const objectKey = path.posix.join(input.dest.object_folder, avifFileName); // Use posix to ensure forward slashes

  try {
    // Read and convert the image to AVIF using sharp
    let imageBuffer: Buffer;

    if (input.source.type === 'local') {
      // Read the image from the local filesystem
      imageBuffer = await fs.readFile(input.source.file_path);
    } else if (input.source.type === 'remote') {
      // Download the image from the remote URL
      imageBuffer = await download_image(input.source.file_url);
    } else {
      throw new Error('Invalid input type');
    }

    const avifBuffer = await sharp(imageBuffer)
      .avif({ quality: 85 })
      .toBuffer();

    // Prepare the upload parameters
    const uploadParams = {
      Bucket: input.dest.bucket_name,
      Key: objectKey,
      Body: avifBuffer,
      ACL: 'public-read' as ObjectCannedACL,
      ContentType: 'image/avif',
    };

    // Use @aws-sdk/lib-storage for managed uploads (supports multipart)
    const parallelUploads3 = new Upload({
      client: s3Client,
      params: uploadParams,
      // You can adjust concurrency and part size as needed
      // In practice, we shouldn't need this because these should be small, optimized images
      queueSize: 4, // concurrent uploads
      partSize: 5 * 1024 * 1024, // 5 MB
    });

    // Await the upload
    await parallelUploads3.done();

    console.log(
      `File '${input.source.type === 'local' ? input.source.file_path : input.source.file_url}' uploaded successfully to '${input.dest.bucket_name}/${objectKey}'.`
    );

    return {
      optimized_img_url: `https://${input.dest.bucket_name}.${REGION}.cdn.digitaloceanspaces.com/${objectKey}`
    };
  } catch (error) {
    console.error('Error:', (error as Error).message);
    throw error;
  }
}

export const uploadOptimizedImageTask = task({
  id: "upload-optimized-image",
  maxDuration: 30, // 30 seconds
  run: async (payload: OptimizeImageInput, { ctx }) => {
    logger.log("optimizing", { payload });

    const result = await upload_image_to_digital_ocean_spaces(payload);

    logger.log("usage", usage.getCurrent());

    return {
      result
    };
  },
});
