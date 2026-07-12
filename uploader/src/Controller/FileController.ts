import { v4 } from "uuid";
//import {HttpRequest, HttpResponse} from "uWebSockets.js";
//import {Readable} from 'stream'
import { AxiosError } from "axios";
import { Express } from "express";
import multer from "multer";
import { uploaderService, CdnNotConfiguredError } from "../Service/UploaderService";
import { getCdnProvider, isCdnConfigured } from "../Service/StorageProviderService";
import { ByteLenghtBufferException } from "../Exception/ByteLenghtBufferException";
import {
  ADMIN_API_URL,
  ENABLE_CHAT_UPLOAD,
  S3_CDN_USER_REFS_BUCKET,
  UPLOAD_MAX_FILESIZE,
  UPLOADER_URL,
} from "../Enum/EnvironmentVariable";
import { HttpResponseDevice } from "./HttpResponseDevice";

const upload = multer({
  storage: multer.memoryStorage(),
});

class DisabledChat extends Error {}
class NotLoggedUser extends Error {}

export class FileController {
  constructor(private App: Express) {
    this.App = App;

    this.uploadAudioMessage();
    this.downloadAudioMessage();
    this.downloadFile();
    this.uploadFile();
    this.deleteUploadedFile();
    this.ping();
    this.config();
  }

  uploadAudioMessage() {
    /*this.App.options("/upload-audio-message", (req: Request, res: Response) => {
            res.status(200).send("");
        });*/

    this.App.post(
      "/upload-audio-message",
      upload.single("file"),
      async (request, response) => {
        if (!request.file) {
          return response.status(400).send("No files were uploaded.");
        }

        const audioMessageId = v4();

        await uploaderService.uploadTempFile(
          audioMessageId,
          request.file.buffer,
          60
        );

        return response.status(200).json({
          id: audioMessageId,
          path: `/download-audio-message/${audioMessageId}`,
        });
      }
    );
  }

  downloadAudioMessage() {
    this.App.get("/download-audio-message/:id", (request, response) => {
      const id = request.params["id"];
      uploaderService
        .getTemp(id)
        .then((buffer) => {
          const targetDevice = new HttpResponseDevice(id, response);
          return targetDevice.copyFromBuffer(buffer);
        })
        .catch((e) => {
          console.error(e);
          return response.status(500).send("Internal server error");
        });
    });
  }

  downloadFile() {
    this.App.get("/upload-file/:id", (request, response) => {
      const id = request.params["id"];
      const targetDevice = new HttpResponseDevice(id, response);
      uploaderService.copyFile(id, targetDevice);
    });
  }

  uploadFile() {
    this.App.post("/upload-file", upload.any(), async (request, response) => {
      if (!request.files) {
        return response.status(400).send("No files were uploaded.");
      }

      const userRoomToken = request.body.userRoomToken;
      const bucket: string | undefined = S3_CDN_USER_REFS_BUCKET || undefined;

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

        // Validate session token if admin API is configured
        if (ADMIN_API_URL && !userRoomToken) {
          throw new NotLoggedUser();
        }

        for (const file of files) {
          // This is needed because of a bug in busboy. Remove this when https://github.com/expressjs/multer/pull/1158 is merged
          const filename = Buffer.from(file.originalname, "latin1").toString(
            "utf8"
          );
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
          if (bucket) {
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
        }
        throw err;
      }
    });
  }

  deleteUploadedFile() {
    this.App.delete("/upload-file/:fileId", (request, response) => {
      (async () => {
        const fileId = decodeURI(request.params["fileId"]);
        await uploaderService.deleteFileById(fileId);
        return response.json({ message: "ok", id: fileId });
      })().catch((e) => console.error(e));
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
