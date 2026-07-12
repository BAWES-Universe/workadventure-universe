import AWS, {S3} from "aws-sdk";
import {CORSRules} from "aws-sdk/clients/s3";
import {
    AWS_ACCESS_KEY_ID,
    AWS_BUCKET,
    AWS_DEFAULT_REGION,
    AWS_ENDPOINT,
    AWS_SECRET_ACCESS_KEY,
    UPLOADER_AWS_SIGNED_URL_EXPIRATION
} from "../Enum/EnvironmentVariable";
import {StorageProvider} from "./StorageProvider";
import {TargetDevice} from "./TargetDevice";

export class S3StorageProvider implements StorageProvider {
    private s3: AWS.S3 | undefined;

    constructor(
        private bucketName: string = AWS_BUCKET ?? '',
        private region: string | undefined = AWS_DEFAULT_REGION,
        private endpoint: string | undefined = AWS_ENDPOINT,
        private accessKeyId: string | undefined = AWS_ACCESS_KEY_ID,
        private secretAccessKey: string | undefined = AWS_SECRET_ACCESS_KEY,
    ) {
    }

    static isEnabled(): boolean {
        return !!AWS_BUCKET && !!AWS_ACCESS_KEY_ID && !!AWS_SECRET_ACCESS_KEY && !!AWS_DEFAULT_REGION
    }

    async upload(fileUuid: string, chunks: Buffer, mimeType:string|undefined, bucket?: string): Promise<string> {
        const targetBucket = bucket || this.bucketName;
        if (!targetBucket) {
            throw new Error("No bucket configured for upload");
        }
        let uploadParams: S3.Types.PutObjectRequest = {
            Bucket: targetBucket,
            Key: fileUuid,
            Body: chunks
        };

        if(mimeType !== undefined){
            uploadParams = {
                ...uploadParams,
                ContentType: mimeType,
            };
        }

        //upload file in data
        await this.S3().upload(uploadParams,  (err, data)  => {
            if (err || !data) {
                throw err;
            }
            return data;
        }).promise();
        return fileUuid
    }

    async deleteFileById(fileId: string): Promise<void> {
        const deleteParams: S3.Types.DeleteObjectRequest = {
            Bucket: this.bucketName,
            Key: fileId
        };
        await this.S3().deleteObject(deleteParams).promise();
    }

    copyFile(fileId: string, target: TargetDevice): void {
        this.getExternalDownloadLink(fileId).then(link => target.copyFromLink(link))
    }

    private async getExternalDownloadLink(fileId: string): Promise<string> {
        const params = {Bucket: this.bucketName, Key: fileId, Expires: UPLOADER_AWS_SIGNED_URL_EXPIRATION};
        return await this.S3().getSignedUrlPromise('getObject', params);
    }

    private S3() {
        if (this.s3 === undefined) {
            // Create S3 service object with per-instance credentials
            const options: AWS.S3.ClientConfiguration = {
                apiVersion: '2006-03-01',
                s3ForcePathStyle: true,
                accessKeyId: this.accessKeyId,
                secretAccessKey: this.secretAccessKey,
                region: this.region,
            };
            if (this.endpoint){
                (options as Record<string, unknown>).endpoint = this.endpoint
            }
            if (!this.bucketName) throw new Error(`Bucket name must be set on S3StorageProvider`)
            this.s3 = new AWS.S3(options);
            const corsRules:CORSRules = [
                {
                    "AllowedHeaders": [ "Authorization" ],
                    "AllowedMethods": [ "GET", "HEAD" ],
                    // It must be a wildcard because file will be downloaded via redirect and origin is set to null
                    "AllowedOrigins": [ "*" ],
                    "ExposeHeaders": [ "Access-Control-Allow-Origin" ]
                }
            ]
            console.log(options);
            this.s3.putBucketCors({Bucket: this.bucketName, CORSConfiguration: {CORSRules: corsRules}}, (err, _data)=> {
                if (err) {
                    console.log("Could not setup CORS for S3 bucket", err);
                    return
                }
            })
        }
        return this.s3
    }
}
export const s3StorageProvider = S3StorageProvider.isEnabled()? new S3StorageProvider() : null;
