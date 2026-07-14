const fs = require('fs');
const path = require('path');
const https = require('https');

const targetDir = path.join(__dirname, 'models', 'sherpa-onnx-streaming-paraformer-bilingual-zh-en');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const files = [
  'encoder.int8.onnx',
  'decoder.int8.onnx',
  'tokens.txt'
];

const baseUrl = 'https://hf-mirror.com/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en/resolve/main/';

// 单次下载尝试
function downloadOnce(fileName) {
  return new Promise((resolve, reject) => {
    const fileUrl = baseUrl + fileName;
    const destPath = path.join(targetDir, fileName);
    const file = fs.createWriteStream(destPath);

    const request = (url) => {
      https.get(url, { rejectUnauthorized: false }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          // 处理所有 3xx 重定向（包括 308）
          request(response.headers.location);
        } else if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        } else {
          file.close();
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          reject(new Error(`状态码异常: ${response.statusCode}`));
        }
      }).on('error', (err) => {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(err);
      });
    };

    request(fileUrl);
  });
}

// 带重试的下载（最多 3 次，指数退避）
async function downloadFile(fileName, maxRetries = 3) {
  const destPath = path.join(targetDir, fileName);

  // 已存在则跳过
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    console.log(`跳过（已存在）: ${fileName}`);
    return;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`下载中 [${attempt}/${maxRetries}]: ${fileName}`);
      await downloadOnce(fileName);
      console.log(`完成: ${fileName}`);
      return;
    } catch (err) {
      console.error(`第 ${attempt} 次失败: ${err.message}`);
      if (attempt < maxRetries) {
        const delay = attempt * 3000;
        console.log(`${delay / 1000}s 后重试...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw new Error(`${fileName} 下载失败（已重试 ${maxRetries} 次）: ${err.message}`);
      }
    }
  }
}

async function start() {
  try {
    for (const file of files) {
      await downloadFile(file);
    }
    console.log('\n✅ 所有文件下载完成，可以运行 npm start 启动应用！');
  } catch (err) {
    console.error('\n❌ 下载失败:', err.message);
    process.exit(1);
  }
}

start();
