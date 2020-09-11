<template>
	<div id="app">
		<div class="upload">
			<input ref="file" type="file" @change="handleFile" />
			<el-button @click="handleUpload" :disabled="uploadDisabled">上传</el-button>
			<el-button @click="handleResume" v-if="status === 'pause'">恢复</el-button>
			<el-button @click="handlePause" v-if="status === 'uploading'">暂停</el-button>
			<el-button @click="handleClear" v-if="status === 'success'">清空</el-button>
		</div>
		<div class="progress">
			<div>上传进度</div>
			<el-progress :percentage="fakeUploadPercentage"></el-progress>
		</div>
	</div>
</template>

<script>
import SparkMD5 from 'spark-md5'
const chunkSize = 0.1 * 1024 * 1024 //切片大小
export default {
	name: 'app',
	data() {
		return {
			container: {
				file: null, //整个文件
				hash: '', //文件hash值
				fileList: [], //所有切片
				chunksLength: 0, //所有的切片数量
				successUpload: 0 //已上传的切片数量
			},
			status: 'wait', //当前状态
			fakeUploadPercentage: 0, //上传进度
			secondUpload: false //是否秒传
		}
	},
	computed: {
		uploadDisabled() {
			if (this.container.file && this.status === 'wait') {
				return false
			} else {
				return true
			}
		}
	},
	methods: {
		//获取文件
		handleFile() {
			let file = this.$refs.file.files[0]
			if (!file) return
			this.container.file = file
		},
		//上传文件
		async handleUpload() {
			if (!this.container.file) return
			this.status = 'uploading'
			await this.fileSlice(this.container.file)
			this.container.hash = await this.hashFile()
			let { data } = await this.hasUpload(this.container.file.name, this.container.hash)
			if (data.upload) {
				this.$message.success('秒传：上传成功')
				this.secondUpload = true
				this.status = 'success'
				this.fakeUploadPercentage = 100
				return
			}
			this.uploadList = this.container.fileList.map(({ file }, index) => ({
				fileHash: this.container.hash,
				index,
				name: this.container.hash + '-' + index,
				chunk: file,
				size: file.size
			}))
			this.container.successUpload = data.hasUploadList.length
			await this.uploadChunk(data.hasUploadList || [])
		},
		//文件切片
		async fileSlice(file) {
			const fileList = []
			let chunksLength = Math.ceil(file.size / chunkSize)
			let currentIndex = 0
			while (currentIndex < chunksLength) {
				fileList.push({
					file: file.slice(currentIndex * chunkSize, (currentIndex + 1) * chunkSize)
				})
				currentIndex += 1
			}
			this.container.fileList = fileList
			this.container.chunksLength = chunksLength
		},
		//文件哈希
		async hashFile() {
			return new Promise((resolve, reject) => {
				const spark = new SparkMD5.ArrayBuffer()
				const reader = new FileReader()
				reader.readAsArrayBuffer(this.container.file)
				reader.onload = e => {
					spark.append(e.target.result)
					const sparkMd5 = new SparkMD5()
					sparkMd5.append(spark.end())
					sparkMd5.append(this.container.file.name)
					resolve(sparkMd5.end())
				}
			})
		},
		//获取已上传切片
		async hasUpload(filename, fileHash) {
			let { data } = await this.request({
				url: 'http://localhost:3000/api/hasUplaod',
				headers: {
					'Content-Type': 'application/json;charset=utf-8'
				},
				data: JSON.stringify({
					filename,
					fileHash
				})
			})
			return JSON.parse(data)
		},
		//上传切片，已上传的不再上传
		async uploadChunk(hasUploadList) {
			let requestList = this.uploadList
				.filter(({ name }) => !hasUploadList.includes(name))
				.map(data => {
					let { chunk, name, index, fileHash } = data
					let formData = new FormData()
					formData.append('name', name)
					formData.append('filename', this.container.file.name)
					formData.append('fileHash', fileHash)
					formData.append('file', chunk)
					return { formData, error: 0 }
				})
			this.sendRequest(requestList)
		},
		//暂停上传
		handlePause() {
			this.status = 'pause'
		},
		//恢复上传
		async handleResume() {
			this.status = 'uploading'
			const { data } = await this.hasUpload(this.container.file.name, this.container.hash)
			await this.uploadChunk(data.hasUploadList || [])
		},
		//ajax请求
		request({ url, method = 'POST', data, headers = {}, onProgress }) {
			return new Promise((resolve, reject) => {
				const xhr = new XMLHttpRequest()
				xhr.open(method, url)
				xhr.upload.onprogress = onProgress
				Object.keys(headers).forEach(item => {
					xhr.setRequestHeader(item, headers[item])
				})
				xhr.send(data)
				xhr.onload = e => {
					if (e.target.status == 200 || e.target.status == 304) {
						resolve({
							data: e.target.response
						})
					} else {
						reject({
							data: e.target.response
						})
					}
				}
			})
		},
		//异步任务并发 + 重试
		sendRequest(chunks, limit = 5) {
			return new Promise((resolve, reject) => {
				const len = chunks.length
				let counter = 0
				let isStop = false
				const start = async () => {
					if (isStop) {
						console.log('重试失败，停止上传')
						return
					}
					if (this.status === 'pause') {
						console.log('暂停上传')
						return
					}
					const task = chunks.shift()
					if (task) {
						try {
							await this.request({
								url: 'http://localhost:3000/api/willUpload',
								data: task.formData,
								onProgress: this.progressHandler
							})
							if (counter == len - 1) {
								resolve()
							} else {
								counter++
								start()
							}
						} catch (e) {
							console.log('出错了')
							if (task.error < 3) {
								task.error++
								//队首进去，准备重试
								chunks.unshift(task)
								start()
							} else {
								isStop = true
								reject()
							}
						}
					}
				}
				while (limit > 0) {
					start()
					limit -= 1
				}
			})
		},
		//切片上传进度处理
		progressHandler(e) {
			if (e.loaded / e.total == 1) {
				this.container.successUpload += 1
				const fakeUploadPercentage = (this.container.successUpload / this.container.chunksLength) * 100
				this.fakeUploadPercentage = Number(fakeUploadPercentage.toFixed(1))
			}
		},
		//上传成功后可清除文件
		handleClear() {
			this.$refs.file.value = ''
			this.status = 'wait'
			this.fakeUploadPercentage = 0
			this.secondUpload = false
			this.container = {
				file: null,
				hash: '',
				fileList: [],
				chunksLength: 0,
				successUpload: 0
			}
		}
	},
	//上传完成之后发送合并请求
	watch: {
		fakeUploadPercentage: async function(newVal, oldVal) {
			if (newVal == 100 && this.secondUpload === false) {
				try {
					let res = await this.request({
						url: 'http://localhost:3000/api/margeFile',
						headers: {
							'Content-Type': 'application/json;charset=utf-8'
						},
						data: JSON.stringify({
							filename: this.container.file.name,
							fileHash: this.container.hash
						})
					})
					const data = JSON.parse(res.data)
					if (data.code == 200) {
						this.status = 'success'
						this.$message.success('上传成功')
					}
				} catch (e) {
					console.log('合并失败', e)
					this.$message.success('合并失败')
				}
			}
		}
	}
}
</script>

<style scoped>
#app {
	padding: 50px 200px;
}
.upload {
	margin-bottom: 50px;
}
</style>
