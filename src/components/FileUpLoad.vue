<template>
  <div>
    <input type="file" @change="handleFileChange" />
    <el-button @click="handleUpload">上传</el-button>
  </div>
</template>

<script>
const LENGTH = 10 // 切片数量

export default {
  name: 'FileUpLoad',
  data() {
    return {
      container: {
        file: null,
        data: []
      }
    }
  },
  methods: {
    // 选中文件
    handleFileChange(e) {
      const [file] = e.target.files
      if (!file) return
      Object.assign(this.$data, this.$options.data()) // 将初始数据与现有数据合并
      this.container.file = file
    },
    // 上传请求
    request({
      url,
      method = "post",
      data,
      headers = {},
      // requestList // 文件切片数组
    }) {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest()
        xhr.open(method, url)
        Object.keys(headers).forEach(key => {
          xhr.setRequestHeader(key, headers[key])
        })
        xhr.send(data)
        xhr.onload = e => {
          resolve({
            data: e.target.response
          })
        }
      })
    },
    // 文件切片
    createFileChunk(file, length = LENGTH) {
      const fileChunkList = []
      this.chunkSize = Math.ceil(file.size / length)
      let cur = 0
      while (cur < file.size) {
        fileChunkList.push({ file: file.slice(cur, cur + this.chunkSize) })
        cur += this.chunkSize
      }
      return fileChunkList
    },
    // 合并切片
    async mergeRequest() {
      await this.request({
        url: "http://localhost:5008/merge",
        headers: {
          "content-type": "application/json"
        },
        data: JSON.stringify({
          size: this.chunkSize,
          filename: this.container.file.name
        })
      })
    },
    // 上传切片
    async uploadChunks() {
      const requestList = this.data.map(({ chunk, hash }) => {
        const formData = new FormData()
        formData.append("chunk", chunk)
        formData.append("hash", hash)
        formData.append("filename", this.container.file.name)
        return { formData }
      }).map(async ({ formData }) =>
        this.request({
          url: "http://localhost:5008",
          data: formData
        })
      )
      await Promise.all(requestList) // 并发切片
      // 合并切片
      await this.mergeRequest()
    },
    
    // 上传操作
    async handleUpload() {
      if (!this.container.file) return
      const fileChunkList = this.createFileChunk(this.container.file)
      this.data = fileChunkList.map(({ file }, index) => ({
        chunk: file,
        hash: this.container.file.name + "-" + index // 文件名 + 数组下标
      }))
      // 上传切片
      await this.uploadChunks()
    }
  }
}
</script>

<style scoped>

</style>
