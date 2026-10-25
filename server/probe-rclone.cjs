const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
(async () => {
  const s3 = new S3Client({ region: 'us-east-1', endpoint: 'http://127.0.0.1:9000', forcePathStyle: true, credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' } });
  const putUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: 'dijiang', Key: 'probe.txt', ContentType: 'text/plain' }), { expiresIn: 300 });
  console.log('PUT_URL', putUrl.slice(0, 120));
  const put = await fetch(putUrl, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: 'hello-rclone' });
  console.log('PUT', put.status, (await put.text()).slice(0, 200));
  const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: 'dijiang', Key: 'probe.txt' }), { expiresIn: 300 });
  const get = await fetch(getUrl);
  console.log('GET', get.status, (await get.text()).slice(0, 100));
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
