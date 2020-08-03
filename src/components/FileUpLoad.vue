<template>
  <div>
    <div>
      <input type="file" @change="handleFileChange" />
      <el-button @click="handleUpload">上传</el-button>
      <el-button @click="handlePause" v-if="isPaused">暂停</el-button>
      <el-button @click="handleResume" v-else>恢复</el-button>
    </div>
    <div>
      <div>计算文件 hash</div>
      <el-progress :percentage="hashPercentage"></el-progress>
      <div>总进度</div>
      <el-progress :percentage="fakeUploadPercentage"></el-progress>
    </div>
    <div>
      <el-table :data="data">
        <el-table-column
          prop="hash"
          label="切片hash"
          align="center"
        ></el-table-column>
        <el-table-column label="大小(KB)" align="center" width="120">
          <template v-slot="{ row }">
            {{ row.size | transformByte }}
          </template>
        </el-table-column>
        <el-table-column label="进度" align="center">
          <template v-slot="{ row }">
            <el-progress
              :percentage="row.percentage"
              color="#909399"
            ></el-progress>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script>
const LENGTH = 10 // 切片数量

export default {
  name: 'FileUpLoad',
  filters: {
    transformByte(val) {
      return Number((val / 1024).toFixed(0));
    }
  },
  data() {
    return {
      container: {
        file: null,
        fileHash: '',
        worker: null
      },
      data: [],
      hashPercentage: 0,
      requestList: [],
      isPaused: true,
      fakeUploadPercentage: 0
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
    // 上传请求
    request({
      url,
      method = "post",
      data,
      headers = {},
      onProgress = e => e,
      requestList // 文件切片数组
    }) {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = onProgress
        xhr.open(method, url)
        Object.keys(headers).forEach(key => {
          xhr.setRequestHeader(key, headers[key])
        })
        xhr.send(data)
        xhr.onload = e => {
          // 将请求成功的 xhr 从列表中删除
          if (requestList) {
            const xhrIndex = requestList.findIndex(item => item === xhr);
            requestList.splice(xhrIndex, 1);
          }
          resolve({
            data: e.target.response
          })
        }
        // 暴露当前 xhr 给外部(?.可选链操作符)
        requestList?.push(xhr)
      })
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
          filename: this.container.file.name,
          fileHash: this.container.fileHash
        })
      })
    },
    // 切片进度处理
    createProgressHandler(chunk) {
      return e => {
        chunk.percentage = parseInt(String((e.loaded / e.total) * 100))
      }
    },
    // 上传切片，同时过滤已上传的切片
    async uploadChunks(uploadedList) {
      const requestList = this.data.filter(
        // 过滤已上传的切片
        ({ hash }) => !uploadedList.includes(hash)
      ).map(({ chunk, fileHash, index, hash }) => {
        const formData = new FormData()
        formData.append("chunk", chunk)
        formData.append("hash", hash)
        formData.append("fileHash", fileHash)
        formData.append("filename", this.container.file.name)
        return { formData, index }
      }).map(async ({ formData, index }) =>
        this.request({
          url: "http://localhost:5008",
          data: formData,
          onProgress: this.createProgressHandler(this.data[index]),
          requestList: this.requestList
        })
      )
      await Promise.all(requestList) // 并发切片
      // 合并切片
      // 之前上传的切片数量 + 本次上传的切片数量 = 所有切片数量时
      if (uploadedList.length + requestList.length === this.data.length) {
        await this.mergeRequest()
      }
    },
    // 生成文件 hash（web-worker）
    calculateHash(fileChunkList) {
      return new Promise(resolve => {
        this.container.worker = new Worker("/hash.js")
        this.container.worker.postMessage({ fileChunkList })
        this.container.worker.onmessage = e => {
          const { percentage, hash } = e.data
          this.hashPercentage = percentage
          if (hash) {
            resolve(hash)
          }
        }
      })
    },
    // 根据 hash 验证文件是否曾经已经被上传过
    // 没有才进行上传
    async verifyUpload(filename, fileHash) {
      const { data } = await this.request({
        url: "http://localhost:5008/verify",
        headers: {
          "content-type": "application/json"
        },
        data: JSON.stringify({
          filename,
          fileHash
        })
      })
      return JSON.parse(data)
    },
    // 上传操作
    async handleUpload() {
      if (!this.container.file) return
      const fileChunkList = this.createFileChunk(this.container.file)
      // 生成文件hash
      this.container.fileHash = await this.calculateHash(fileChunkList)
      // 验证文件是否已经上传
      const { shouldUpload, uploadedList } = await this.verifyUpload(
        this.container.file.name,
        this.container.fileHash
      )
      if (!shouldUpload) {
        this.$message.success("秒传：上传成功")
        // this.status = Status.wait
        return
      }
      this.data = fileChunkList.map(({ file }, index) => ({
        fileHash: this.container.fileHash,
        chunk: file,
        index,
        size: file.size,
        percentage: uploadedList.includes(index) ? 100 : 0, // 百分比
        hash: this.container.file.name + "-" + index // 文件名 + 数组下标
      }))
      // 上传切片，同时过滤已上传的切片
      await this.uploadChunks(uploadedList)
    },
    handlePause() {
      // (?.可选链操作符)
      this.requestList.forEach(xhr => xhr?.abort())
      this.requestList = []
      this.isPaused = false
    },
    async handleResume() {
      this.isPaused = true
      const { uploadedList } = await this.verifyUpload(
        this.container.file.name,
        this.container.fileHash
      )
      await this.uploadChunks(uploadedList)
    }
  },
  computed: {
    uploadPercentage() {
      if (!this.container.file || !this.data.length) return 0
      const loaded = this.data.map(
        item => item.size * item.percentage
      ).reduce(
        (acc, cur) => acc + cur
      )
      return parseInt((loaded / this.container.file.size).toFixed(2));
    }
  },
  watch: {
    uploadPercentage(now) {
      if (now > this.fakeUploadPercentage) {
        this.fakeUploadPercentage = now;
      }
    }
  }
}
</script>

<style scoped>

</style>
