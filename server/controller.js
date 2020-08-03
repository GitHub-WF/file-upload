const path = require("path")
const fse = require("fs-extra")
const multiparty = require("multiparty")
const UPLOAD_DIR = path.resolve(__dirname, '..', "target") // 大文件存储目录
const extractExt = filename => filename.slice(filename.lastIndexOf("."), filename.length) // 提取后缀名

// 返回已经上传切片名
const createUploadedList = async fileHash =>
  fse.existsSync(path.resolve(UPLOAD_DIR, fileHash)) ?
  await fse.readdir(path.resolve(UPLOAD_DIR, fileHash)) :
  []

// 拼接文件
const resolvePost = req => new Promise(resolve => {
  let chunk = ""
  req.on("data", data => {
    chunk += data
  })
  req.on("end", () => {
    resolve(JSON.parse(chunk))
  })
})
// 可写流
const pipeStream = (path, writeStream) => new Promise(resolve => {
  const readStream = fse.createReadStream(path)
  readStream.on("end", () => {
    fse.unlinkSync(path)
    resolve()
  })
  readStream.pipe(writeStream)
})
// 合并切片文件
const mergeFileChunk = async (filePath, fileHash, size) => {
  const chunkDir = path.resolve(UPLOAD_DIR, fileHash)
  const chunkPaths = await fse.readdir(chunkDir)
  // 根据切片下标进行排序
  // 否则直接读取目录的获得的顺序可能会错乱
  chunkPaths.sort((a, b) => a.split("-")[1] - b.split("-")[1])
  await Promise.all(
    chunkPaths.map((chunkPath, index) =>
      pipeStream(
        path.resolve(chunkDir, chunkPath),
        // 指定位置创建可写流
        fse.createWriteStream(filePath, {
          start: index * size,
          end: (index + 1) * size
        })
      )
    )
  )
  fse.rmdirSync(chunkDir) // 合并后删除保存切片的目录
}

module.exports = class {
  // 切片文件处理
  async handleFormData(req, res) {
    const multipart = new multiparty.Form()
    multipart.parse(req, async (err, fields, files) => {
      if (err) return
      const [chunk] = files.chunk
      const [hash] = fields.hash
      const [fileHash] = fields.fileHash
      const [filename] = fields.filename
      const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${extractExt(filename)}`)
      const chunkDir = path.resolve(UPLOAD_DIR, fileHash)
      // 文件存在直接返回
      if (fse.existsSync(filePath)) {
        res.end("file exist")
        return
      }
      // 切片目录不存在，创建切片目录
      if (!fse.existsSync(chunkDir)) {
        await fse.mkdirs(chunkDir)
      }
      // fs-extra 专用方法，类似 fs.rename 并且跨平台
      // fs-extra 的 rename 方法 windows 平台会有权限问题
      // 将文件临时目录转移到指定目录
      await fse.move(chunk.path, `${chunkDir}/${hash}`)
      res.end(`${hash} file chunk received over`)
    })
  }
  // 合并切片
  async handleMerge(req, res) {
    const data = await resolvePost(req)
    const { fileHash, filename, size } = data
    const ext = extractExt(filename)
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`)
    await mergeFileChunk(filePath, fileHash, size)
    res.end(
      JSON.stringify({
        code: 0,
        message: "file merged success"
      })
    )
    return
  }
  // 验证文件是否已上传
  async handleVerifyUpload(req, res) {
    const data = await resolvePost(req)
    const { fileHash, filename } = data
    const ext = extractExt(filename)
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`)
    if (fse.existsSync(filePath)) {
      res.end(
        JSON.stringify({
          shouldUpload: false
        })
      )
    } else {
      res.end(
        JSON.stringify({
          shouldUpload: true,
          uploadedList: await createUploadedList(fileHash)
        })
      )
    }
  }
}