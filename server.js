require('dotenv').config()
const express = require('express')
const cookieSession = require('cookie-session')
const flash = require('connect-flash')
const methodOverride = require('method-override')
const path = require('path')

// 1. นำเข้า ejs แบบตรงๆ เพื่อบังคับให้ Bundler เอาแพ็กเกจนี้ขึ้นไปด้วย
const ejs = require('ejs')

const app = express()
const PORT = process.env.PORT || 3000

// --- ส่วนที่แก้ไขสำคัญสำหรับ Netlify Serverless ---

// 2. สำคัญมาก: ตั้งค่า Proxy เพื่อให้ Cookie แบบ Secure ทำงานได้บน Netlify
app.set('trust proxy', 1)

// 3. บังคับให้ Express ใช้ ejs ตัวที่เรา require มา (แก้ปัญหา Cannot find module 'ejs' ได้ 100%)
app.engine('ejs', ejs.__express)
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

// ---------------------------------------------

// Static files (served by Netlify CDN in production, Express in dev)
app.use(express.static(path.join(__dirname, 'public')))

// Body parsers
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
// Capture raw body for LINE webhook signature verification
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    if (req.originalUrl.includes('/ecommerce/webhook/')) {
      req.rawBody = buf
    }
  }
}))
app.use(methodOverride('_method'))

// Cookie-based session (stateless — works on serverless/Netlify)
app.use(cookieSession({
  name: 'bizflow',
  secret: process.env.SESSION_SECRET || 'dev-only-not-for-production',
  maxAge: 24 * 60 * 60 * 1000,
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true,
  sameSite: 'lax'
}))

// connect-flash ต้องการ req.session ซึ่ง cookie-session จัดให้แล้ว
app.use(flash())

// Global locals
app.use((req, res, next) => {
  res.locals.appName    = process.env.APP_NAME    || 'BizFlow'
  res.locals.companyName = process.env.COMPANY_NAME || 'STDESIGN CO., LTD.'
  res.locals.user       = req.session.user || null
  next()
})

// Routes
app.use('/', require('./routes/auth'))
app.use('/dashboard', require('./routes/dashboard'))
app.use('/income', require('./routes/income'))
app.use('/sales', require('./routes/sales'))
app.use('/hr', require('./routes/hr'))
app.use('/products', require('./routes/products'))
app.use('/customers', require('./routes/customers'))
app.use('/reports', require('./routes/reports'))
app.use('/ecommerce', require('./routes/ecommerce'))

// Root redirect
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard')
  res.redirect('/login')
})

// 404
app.use((req, res) => {
  res.status(404).render('error', {
    message: 'ไม่พบหน้าที่คุณต้องการ',
    code: 404
  })
})

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).render('error', {
    message: 'เกิดข้อผิดพลาดภายในระบบ',
    code: 500
  })
})

// รัน server เฉพาะตอน dev (node server.js)
// บน Netlify ไม่ต้อง listen — serverless-http จัดการแทน
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 BizFlow running at http://localhost:${PORT}`)
  })
}

module.exports = app