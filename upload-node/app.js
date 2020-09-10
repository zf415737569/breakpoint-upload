const Koa = require('koa')
const koaBody = require('koa-body')
const cors = require('koa2-cors')
const Router = require('koa-router')
const router = new Router()
const subRouter = require('./router')

const app = new Koa()
const PORT = 3000

router.use('/api', subRouter.routes())

app
	.use(
		koaBody({
			multipart: true
		})
	)
	.use(router.routes())
	.listen(PORT, () => {
		console.log(`server is running on port ${PORT}`)
	})
