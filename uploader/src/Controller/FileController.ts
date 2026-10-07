import { v4 } from "uuid";
//import {HttpRequest, HttpResponse} from "uWebSockets.js";
//import {Readable} from 'stream'
import { AxiosError } from "axios";
import { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import * as Sentry from "@sentry/node";
import { uploaderService, CdnNotConfiguredError } from "../Service/UploaderService";
import { getCdnProvider, isCdnConfigured } from "../Service/StorageProviderService";
import { ByteLenghtBufferException } from "../Exception/ByteLenghtBufferException";
import {
  ADMIN_API_URL,
  ENABLE_CHAT_UPLOAD,
  S3_CDN_USER_REFS_PUBLIC_URL,
  S3_CDN_BOT_GENS_PUBLIC_URL,
  S3_CDN_USER_REFS_BUCKET,
  S3_CDN_BOT_GENS_BUCKET,
  BOT_SERVICE_TOKEN,
  SECRET_KEY,
  UPLOAD_MAX_FILESIZE,
  UPLOADER_URL,
} from "../Enum/EnvironmentVariable";
import {
  AUDIO_MESSAGE_ID_REGEX,
  AUDIO_MESSAGE_MAX_FILE_SIZE,
  getAudioContentType,
  getAudioExtension,
  validateAudioMessage,
} from "../Service/AudioMessageValidator";
import {
  isValidPlayAuthToken,
  isValidPlayGameSession,
} from "../Service/PlayAuthToken";
import { HttpResponseDevice } from "./HttpResponseDevice";

// Files a person may drop in chat at once, and the size of each (the front applies the same limits). multer stops
// reading a body that is over them, so a refused upload is never held in memory or stored.
const MAX_FILES_PER_UPLOAD = 10;
const maxFileSize = UPLOAD_MAX_FILESIZE ? parseInt(UPLOAD_MAX_FILESIZE) : NaN;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_FILES_PER_UPLOAD,
    ...(maxFileSize > 0 ? { fileSize: maxFileSize } : {}),
  },
}).any();

/** True when the request carries the bot server's service token (our own services). */
function isFromBotService(request: Request): boolean {
  const botServiceToken = request.headers["x-bot-service-token"];
  return !!BOT_SERVICE_TOKEN && botServiceToken === BOT_SERVICE_TOKEN;
}

const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AUDIO_MESSAGE_MAX_FILE_SIZE, files: 1 },
}).single("file");

class DisabledChat extends Error {}
class NotLoggedUser extends Error {}

export class FileController {
  constructor(private App: Express) {
    this.App = App;

    if (!SECRET_KEY) {
      console.warn(
        "SECRET_KEY is not set: file uploads are not tied to a game session. Set it to the same value as play's SECRET_KEY."
      );
    }
    this.uploadAudioMessage();
    this.downloadAudioMessage();
    this.downloadFile();
    this.uploadFile();
    this.deleteUploadedFile();
    this.ping();
    this.config();
  }

  uploadAudioMessage() {
    if (!SECRET_KEY) {
      console.warn(
        "SECRET_KEY is not set: audio message uploads are not authenticated. Set it to the same value as play's SECRET_KEY."
      );
    }

    this.App.post("/upload-audio-message", (request, response) => {
      // Checked before multer so that unauthenticated bodies are never buffered.
      if (
        SECRET_KEY &&
        !isValidPlayAuthToken(request.header("authorization"), SECRET_KEY)
      ) {
        response.status(401).json({ message: "not-logged" });
        return;
      }

      uploadAudio(request, response, (err: unknown) => {
        (async () => {
          if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
              return response.status(413).json({
                message: "file-too-big",
                maxFileSize: AUDIO_MESSAGE_MAX_FILE_SIZE,
              });
            }
            return response.status(400).send("Invalid upload.");
          }
          if (err) {
            throw err;
          }
          if (!request.file) {
            return response.status(400).send("No files were uploaded.");
          }

          const extension = validateAudioMessage(
            request.file.originalname,
            request.file.mimetype,
            request.file.buffer
          );
          if (extension === undefined) {
            return response
              .status(415)
              .json({ message: "unsupported-audio-file" });
          }

          // The extension is part of the id so that the download serves an audio Content-Type.
          const audioMessageId = `${v4()}.${extension}`;

          await uploaderService.uploadTempFile(
            audioMessageId,
            request.file.buffer,
            60
          );

          return response.status(200).json({
            id: audioMessageId,
            path: `/download-audio-message/${audioMessageId}`,
          });
        })().catch((e) => {
          console.error(e);
          Sentry.captureException(e);
          if (!response.headersSent) {
            response.status(500).send("Internal server error");
          }
        });
      });
    });
  }

  downloadAudioMessage() {
    this.App.get("/download-audio-message/:id", (request, response) => {
      (async () => {
        const id = request.params["id"];
        const extension = getAudioExtension(id);
        if (!AUDIO_MESSAGE_ID_REGEX.test(id) || extension === undefined) {
          return response.status(404).send("Cannot find file");
        }

        const buffer = await uploaderService.getTemp(id);
        if (buffer == undefined) {
          return response.status(404).send("Cannot find file");
        }

        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader(
          "Content-Disposition",
          `inline; filename="audio.${extension}"`
        );
        response.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; sandbox"
        );
        response.type(getAudioContentType(extension));
        return response.status(200).send(buffer);
      })().catch((e) => {
        console.error(e);
        Sentry.captureException(e);
        if (!response.headersSent) {
          response.status(500).send("Internal server error");
        }
      });
    });
  }

  downloadFile() {
    this.App.get("/upload-file/:id", (request, response) => {
      const id = request.params["id"];
      const targetDevice = new HttpResponseDevice(id, response);
      uploaderService.copyFile(id, targetDevice).catch((e) => {
          console.error(e);
          return response.status(500).send("Internal server error");
      });
    });
  }

  uploadFile() {
    // Checked before multer so that a body from somebody who never opened the game is never buffered.
    const requireGameSession = (
      request: Request,
      response: Response,
      next: NextFunction
    ) => {
      if (
        isFromBotService(request) ||
        !SECRET_KEY ||
        isValidPlayGameSession(request.header("authorization"), SECRET_KEY)
      ) {
        next();
        return;
      }
      response.status(401).json({ message: "not-logged" });
    };

    const readFiles = (
      request: Request,
      response: Response,
      next: NextFunction
    ) => {
      upload(request, response, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            response
              .status(413)
              .json({ message: "file-too-big", maxFileSize: UPLOAD_MAX_FILESIZE });
            return;
          }
          if (err.code === "LIMIT_FILE_COUNT") {
            response.status(400).json({ message: "too-many-files" });
            return;
          }
          response.status(400).send("Invalid upload.");
          return;
        }
        if (err) {
          next(err);
          return;
        }
        next();
      });
    };

    this.App.post("/upload-file", requireGameSession, readFiles, async (request, response) => {
      if (!request.files) {
        return response.status(400).send("No files were uploaded.");
      }

      const userRoomToken = request.body.userRoomToken;
      const botServiceToken = request.headers["x-bot-service-token"] as string | undefined;
      
      // Bot service token check: if valid, route to bot-gens bucket and skip user auth
      const isBotUpload = BOT_SERVICE_TOKEN && botServiceToken === BOT_SERVICE_TOKEN;
      const bucket: string | undefined = isBotUpload
        ? (S3_CDN_BOT_GENS_BUCKET || undefined)
        : (S3_CDN_USER_REFS_BUCKET || S3_CDN_BOT_GENS_BUCKET || undefined);

      // Check file count cap
      if (!request.files || (request.files as Express.Multer.File[]).length > 10) {
        return response.status(400).json({ message: "too-many-files" });
      }
      const files = request.files as Express.Multer.File[];

      try {
        const uploadedFiles: {
          name: string;
          id: string;
          location: string;
          size: number;
          lastModified: Date;
          type?: string;
        }[] = [];

        // Validate session token if admin API is configured (skip for bot uploads)
        if (ADMIN_API_URL && !userRoomToken && !isBotUpload) {
          throw new NotLoggedUser();
        }

        for (const file of files) {
          // This is needed because of a bug in busboy. Remove this when https://github.com/expressjs/multer/pull/1158 is merged
          const filename = Buffer.from(file.originalname, "latin1").toString(
            "utf8"
          );
          // Server-side unsafe extension check (matches frontend)
          const ext = filename
            .substring(filename.lastIndexOf("."))
            .toLowerCase();
          const UNSAFE_EXTENSIONS = [
            ".exe", ".bat", ".cmd", ".com", ".msi", ".scr",
            ".jar", ".dmg", ".pkg", ".app", ".sh", ".bash",
            ".vbs", ".ps1", ".pl", ".py", ".rb",
          ];
          if (UNSAFE_EXTENSIONS.includes(ext)) {
            throw new Error(`Unsafe file type: ${ext}`);
          }
          // Always check file size locally, regardless of ADMIN_API_URL
          if (!ENABLE_CHAT_UPLOAD) {
            throw new DisabledChat("Upload is disabled");
          }
          if (
            UPLOAD_MAX_FILESIZE &&
            file.buffer.byteLength > parseInt(UPLOAD_MAX_FILESIZE)
          ) {
            throw new ByteLenghtBufferException(`file-too-big`);
          }
          const fileUuid = await uploaderService.uploadFile(
            filename,
            file.buffer,
            file.mimetype,
            bucket
          );
          let location: string;
          if (bucket === S3_CDN_USER_REFS_BUCKET && S3_CDN_USER_REFS_PUBLIC_URL) {
            location = `${S3_CDN_USER_REFS_PUBLIC_URL}/${fileUuid}`;
          } else if (bucket === S3_CDN_BOT_GENS_BUCKET && S3_CDN_BOT_GENS_PUBLIC_URL) {
            location = `${S3_CDN_BOT_GENS_PUBLIC_URL}/${fileUuid}`;
          } else if (bucket) {
            const cdnProvider = getCdnProvider(bucket);
            if (cdnProvider) {
              location = await cdnProvider.getSignedUrl(fileUuid);
            } else {
              location = `${UPLOADER_URL}/upload-file/${fileUuid}`;
            }
          } else {
            location = `${UPLOADER_URL}/upload-file/${fileUuid}`;
          }
          uploadedFiles.push({
            name: filename,
            id: fileUuid,
            location: location,
            size: file.buffer.byteLength,
            lastModified: new Date(),
            type: file.mimetype,
          });
        }

        if (uploadedFiles.length === 0) {
          throw new Error("Error upload file");
        }

        response.status(200);
        return response.json(uploadedFiles);
      } catch (err) {
        if (err instanceof ByteLenghtBufferException) {
          response.status(413);
          return response.json({
            message: err.message,
            maxFileSize: UPLOAD_MAX_FILESIZE,
          });
        } else if (err instanceof AxiosError) {
          const status = err.response?.status;
          if (status) {
            if (status == 413) {
              response.status(413);
            } else if (status == 423) {
              response.status(423);
            } else {
              response.status(401);
            }
            return response.json({
              message: err.response?.data?.message,
              maxFileSize: err.response?.data.maxFileSize,
            });
          }
          console.error(err);
          response.status(500);
          return response.json({ message: "Internal server error" });
        } else if (err instanceof DisabledChat) {
          response.status(401);
          return response.json({ message: "disabled" });
        } else if (err instanceof NotLoggedUser) {
          response.status(401);
          return response.json({ message: "not-logged" });
        } else if (err instanceof CdnNotConfiguredError) {
          response.status(400);
          return response.json({
            message: err.message,
          });
        } else {
          console.error(err);
          response.status(500);
          return response.json({ message: "Internal server error" });
        }
      }
    });
  }

  deleteUploadedFile() {
    // Nothing in the game deletes uploads: only our own services (the bot server) may, with their service token.
    this.App.delete("/upload-file/:fileId", (request, response) => {
      if (!isFromBotService(request)) {
        response.status(401).json({ message: "not-allowed" });
        return;
      }
      (async () => {
        const fileId = decodeURI(request.params["fileId"]);
        await uploaderService.deleteFileById(fileId);
        return response.json({ message: "ok", id: fileId });
      })().catch((e) => {
        console.error(e);
        if (!response.headersSent) {
          response.status(500).json({ message: "Internal server error" });
        }
      });
    });
  }

  ping() {
    this.App.get("/ping", (req, res) => {
      res.status(200).send("pong");
    });
  }

  config() {
    this.App.get("/config", (req, res) => {
      res.json({
        cdnConfigured: isCdnConfigured(),
      });
    });
  }
}
