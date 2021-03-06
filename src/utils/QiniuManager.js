const qiniu = require('qiniu')
const axios = require('axios')
const fs = require('fs')
// 构造函数类的写法非常好
// 云这边平时用不到，大体知道一下就行
// AK:  eSnIYUtEZLeWofUnzRmt_zfOXvPBekbQdwWvxK9I
// SK:  9DaiBQg84oYuYg-IcMJDCMYrTQXpCE225ih_OAKc
// Bucket名称：zhangjiclouddoc
class QiniuManager {
  constructor(accessKey, secretKey, bucket ) {
    //generate mac
    this.mac = new qiniu.auth.digest.Mac(accessKey, secretKey)
    // todo bucket是什么，空间吗
    this.bucket = bucket

    // init config class
    this.config = new qiniu.conf.Config()
    // 空间对应的机房
    // todo机房是如何设置的，文档上是写死的
    this.config.zone = qiniu.zone.Zone_z0

    this.bucketManager = new qiniu.rs.BucketManager(this.mac, this.config);
  }
   /**
  * uploadFile上传文件
  * @param key [string] 文件名称；
  * @param localFilePath [string] 文件地址；
  */
  uploadFile(key, localFilePath) {
    // generate uploadToken
    const options = {
      scope: this.bucket + ":" + key,
    };
    const putPolicy = new qiniu.rs.PutPolicy(options)
    const uploadToken=putPolicy.uploadToken(this.mac)
    const formUploader = new qiniu.form_up.FormUploader(this.config)
    const putExtra = new qiniu.form_up.PutExtra()
    //文件上传
    return new Promise((resolve, reject) => {
      formUploader.putFile(uploadToken, key, localFilePath, putExtra, this._handleCallback(resolve, reject));
    })

  }
  deleteFile(key) {
    return new Promise((resolve, reject) => {
      this.bucketManager.delete(this.bucket, key, this._handleCallback(resolve, reject))
    })
  }
  getBucketDomain() {
    const reqURL = `http://api.qiniu.com/v6/domain/list?tbl=${this.bucket}`
    const digest = qiniu.util.generateAccessToken(this.mac, reqURL) // 获取token
    console.log('trigger here')
    return new Promise((resolve, reject) => {
      // 发送请求的
      qiniu.rpc.postWithoutForm(reqURL, digest, this._handleCallback(resolve, reject))
    })
  }
  getStat(key) {
    return new Promise((resolve, reject) => {
      this.bucketManager.stat(this.bucket, key, this._handleCallback(resolve, reject))
    })
  }
  generateDownloadLink(key) {
    const domainPromise = this.publicBucketDomain ? 
    Promise.resolve([this.publicBucketDomain]) : this.getBucketDomain()
    return domainPromise.then(data => {
      if (Array.isArray(data) && data.length > 0) {
        const pattern = /^https?/
        this.publicBucketDomain = pattern.test(data[0]) ? data[0] : `http://${data[0]}`
        return this.bucketManager.publicDownloadUrl(this.publicBucketDomain, key)
      } else {
        throw Error('域名未找到，请查看存储空间是否已经过期')
      }
    })
  }
  downloadFile(key, downloadPath) {
    // step 1 get the download link
    // step 2 send the request to download link, return a readable stream
    // step 3 create a writable stream and pipe to it
    // step 4 return a promise based result
    return this.generateDownloadLink(key).then(link => {
      const timeStamp = new Date().getTime()
      const url = `${link}?timestamp=${timeStamp}`
      return axios({
        url,
        method: 'GET',
        responseType: 'stream', // 默认的是json
        headers: {'Cache-Control': 'no-cache'}
      })
    }).then(response => {
      const writer = fs.createWriteStream(downloadPath)
      response.data.pipe(writer)
      return new Promise((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
      })
    }).catch(err => {
      return Promise.reject({ err: err.response })
    })
  }
  // 高阶函数非常nice写的，柯里化函数
  _handleCallback(resolve, reject) {
    return (respErr, respBody, respInfo) => {
      if (respErr) {
        throw respErr;
      }
      if (respInfo.statusCode === 200) {
        resolve(respBody)
      } else {
        reject({
          statusCode: respInfo.statusCode,
          body: respBody
        })
      }
    }
  }
}

module.exports = QiniuManager