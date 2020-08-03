const Controller = require('./controller')
const http = require('http')
const server = http.createServer()

const controller = new Controller()

server.on("request", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "*")
  if (req.method === "OPTIONS") {
    res.status = 200
    res.end()
    return
  }
  // 验证文件是否已上传
  if (req.url === "/verify") {
    await controller.handleVerifyUpload(req, res)
    return
  }
  // 合并切片接口
  if (req.url === "/merge") {
    await controller.handleMerge(req, res)
    return
  }
  // 上传切片接口
  if (req.url === "/") {
    await controller.handleFormData(req, res)
  }
})

server.listen(5008, () => console.log("http//:localhost:5008"))