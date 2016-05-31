'use strict'

let fs = require('fs')
let path = require('path')
let sw = require('swearing')
let http = require('http')
let html = require('common-tags').html
let url = require('url')

let PDF_DIR = 'pdf'

function testPdfDir (dirPath) {
  return new Promise((resolve, reject) => {
    fs.access(dirPath, err => {
      if (err) { reject(err) }
      resolve(dirPath)
    })
  })
}

function readPdfDir (dirPath) {
  return new Promise((resolve, reject) => {
    fs.readdir(dirPath, (err, files) => {
      if (err) { reject(err) }
      let pdfNames = files
        .map(file => file.toLowerCase())
        .filter(file => path.extname(file) === '.pdf')
        .map(file => path.basename(file, '.pdf'))
      resolve(pdfNames)
    })
  })
}

function getPdfNames () {
  let pdfDir = path.join(process.cwd(), PDF_DIR)
  return testPdfDir(pdfDir).then(readPdfDir)
}

function doGet (url, proxy) {
  let getPromise
  if (!proxy) {
    getPromise = new Promise((resolve, reject) => {
      http.get(url, res => {
        let chunks = []
        res.on('data', data => chunks.push(data.toString()))
        res.on('end', () => resolve(chunks.join()))
      }).on('error', reject)
    })
  } else {
    getPromise = new Promise((resolve, reject) => {
      let requestOptions = {
        host: proxy.host,
        port: proxy.port,
        path: url
      }
      http.request(requestOptions, res => {
        let chunks = []
        res.on('data', (data) => chunks.push(data.toString()))
        res.on('end', () => resolve(chunks.join()))
      }).on('error', reject)
    })
  }
  return getPromise
}

function itEbooksSearch (title, proxy) {
  let shortTitle = title.slice(0, 50)
  let url = `http://it-ebooks-api.info/v1/search/${shortTitle}`
  let itEbooksData
  let bookSearchData

  return doGet(url, proxy).then(data => {
    itEbooksData = JSON.parse(data)
    bookSearchData = itEbooksData.Books[0]
    return
  })
  .then(wait)
  .then(() => {
    return bookSearchData
  })
}

function itBooksDetails (bookId, proxy) {
  let url = `http://it-ebooks-api.info/v1/book/${bookId}`
  let bookData

  return doGet(url, proxy).then(data => {
    bookData = JSON.parse(data)
    return
  })
  .then(wait)
  .then(() => {
    return bookData
  })
}

function wait () {
  return new Promise((resolve, reject) => {
    console.log('waiting')
    let timeoutObj = setInterval(() => {
      clearInterval(timeoutObj)
      return resolve()
    }, 200)
  })
}

function createJsonIndex (path, bookInfos) {
  let books = bookInfos.map(bookInfo => {
    delete bookInfo.Error
    delete bookInfo.Time
    return bookInfo
  })

  return new Promise((resolve, reject) => {
    fs.writeFile(path, JSON.stringify(books), error => {
      if (error) {
        reject(error)
      }
      resolve()
    })
  })
}

function download (path, url) {
  return new Promise((resolve, reject) => {
    let file = fs.createWriteStream(path)
    http.get(url, response => {
      response.pipe(file)
      file.on('finish', () => file.close(resolve))
    }).on('error', err => {
      fs.unlink(path)
      reject(err)
    })
  })
}

function fetchBookImages (dirPath, bookInfos) {
  return sw.each(bookInfos, (bookInfo) => {
    let imageUrl = url.parse(bookInfo.Image)
    let pathname = imageUrl.pathname
    let filename = path.basename(pathname)
    let filePath = path.join(dirPath, filename)
    return download(filePath, imageUrl)
  })
}

function createHtmlReport (path, bookInfos) {
  let template = html`
    <html>
      <head>
        <title>Report</title>
      </head>
      <body>
      <div class="list">
        <ul>
          ${bookInfos.map(bookInfo => `<li>${bookInfo.Title}</li>`)}
        </ul>
      </div>
      </body>
    </html>
  `
  return new Promise((resolve, reject) => {
    fs.writeFile(path, template, error => {
      if (error) {
        reject(error)
      }
      resolve()
    })
  })
}

getPdfNames()
  .then(names => sw.each(names, itEbooksSearch))
  .then(bookSearches => bookSearches.map(bookSearch => bookSearch.ID))
  .then(bookIDs => sw.each(bookIDs, itBooksDetails))
  .then(bookDetails => {
    let outDir = path.join(process.cwd(), PDF_DIR)
    return Promise.all([
      fetchBookImages(path.join(outDir), bookDetails),
      createJsonIndex(path.join(outDir, 'meta.json'), bookDetails),
      createHtmlReport(path.join(outDir, 'report.html'), bookDetails)
    ])
  })
  .then(() => {
    console.log('ok...')
  })
  .catch((err) => { console.log('ERR:' + err) })
