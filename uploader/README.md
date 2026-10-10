# Uploader

The uploader component is in charge of accepting incoming files that can be downloaded by other users.
It is currently used by administrators of maps to send sounds/recordings to everyone on a map.

To support chat uploads, you need to configure one of the storage providers. There are two supported providers, S3 and Redis.

## Browser safety of uploaded files

Images (including SVG), audio and video keep their chat previews. SVG is served with its image type so `<img>` previews
still work, but with `Content-Disposition: attachment` so opening the link downloads it rather than running a standalone
SVG document. Browsers disable script in SVG loaded as an image; the uploader's sandboxed CSP also blocks script.
Other files remain shareable, but are served as `application/octet-stream` with `Content-Disposition: attachment`.
The type comes from a sanitized filename extension, never the multipart content type supplied by the client.
Uploader responses also send `X-Content-Type-Options: nosniff` and a sandboxed Content Security Policy.

S3 uploads store the same safe type and disposition, including in the user-reference and bot-generation CDN buckets.
Presigned downloads override both headers so that old objects downloaded through a newly generated signed link are safe too.
S3's response-override API cannot set CSP or `nosniff`: configure those headers on your CDN if public URLs are enabled.

**Existing public objects:** this code does not rewrite old S3 metadata or cached public CDN responses. Before release,
audit existing HTML/SVG and other non-media objects, give SVG an image type with attachment disposition and other
non-media files the binary download type with attachment disposition, and purge cached responses (or disable public access).
Old direct public links and already-issued
signed URLs cannot be repaired by an uploader deployment alone. Normal inline media needs no migration.

To check SVG previews and HTML/SVG downloads in a browser without a game stack, install the uploader and e2e-test
dependencies, install Playwright's browser, then run `node uploader/tests/browser/verify-file-serving.cjs` from the
repository root. `BROWSER=firefox` or `BROWSER=webkit` selects another installed engine. This uses synthetic files and
an isolated local server, checks both uploader headers and public-CDN metadata, and does not contact a live bucket.

## S3 Storage

When using S3 Storage, attachments will be links to uploader that will in turn generate S3 pre signed URLS
to let you perform the actual download. These URLs will be used automatically (via redirection) by the client,
therefore it can have a short expiration time. By default, the expiration time is 60 seconds, but you can 
adjust setting the `UPLOADER_AWS_SIGNED_URL_EXPIRATION` environment variable.

The following environment variables must be set:
- AWS_BUCKET
- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY
- AWS_DEFAULT_REGION

The user above should have at least the following permissions in its policy
```
 {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "VisualEditor0",
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject"
            ],
            "Resource": [
                "arn:aws:s3:::<AWS_BUCKET>",
                "arn:aws:s3:::<AWS_BUCKET>/*"
            ]
        }
    ]
}
```

To avoid manual work, it is recommended to also give the following permissions:
```
    s3:PutBucketCORS
```
The bucket can be private (and that is recommended), but it must allow cors. Uploader will try to set up thes CORSs header,
but it will fail if the provided credentials does not include permissions (s3:PutBucketCORS). If you really don't want to 
provide this permission, you can try setting the configuration by yourself:
  
- Go to the bucket configuration
- Click on the "Permissions" tab
- Scroll down until you find "Cross-origin resource sharing (CORS)"
- Setup CORS to allow incoming from your WA instance, for example:
```json
[
    {
        "AllowedHeaders": [
            "Authorization"
        ],
        "AllowedMethods": [
            "GET",
            "HEAD"
        ],
        "AllowedOrigins": [
            "*"
        ],
        "ExposeHeaders": [
            "Access-Control-Allow-Origin"
        ]
    }
]
```

Notice that "AllowedOrigins" **must** be a wildcard, because to download files, uploader will generate 
a redirection to a presigned URL to the S3 bucket file and upon redirection `Origin` is set to `null`. 
The generated presigned URLs are set to be valid only for 60 seconds, that ensures security of your assets.

## Redis Storage

You must set up the following variables:
- REDIS_HOST 
- REDIS_PORT

Optionally, you can set the instance password:
- REDIS_PASSWORD

## A note on temporary files

As of now, only Redis storage support "temporary files" (for example, audio files). You can have both AWS
and Redis setup and the uploader will favor AWS for permanent files and Redis for temporary files.

# A note on tests

The tests run in separate node instances because Redis and S3 provider configurations conflict in a global way.

