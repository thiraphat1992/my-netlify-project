// middleware/auth.js
const requireAuth = (req, res, next) => {
  if (req.session && req.session.user) {
    res.locals.user = req.session.user
    return next()
  }
  // API / fetch requests — ส่ง JSON กลับแทนการ redirect HTML
  const isApiReq = req.xhr
    || (req.headers.accept && req.headers.accept.includes('application/json'))
    || (req.headers['content-type'] && req.headers['content-type'].includes('application/json'))
  if (isApiReq) {
    return res.status(401).json({ ok: false, error: 'session หมดอายุ กรุณา reload หน้าเว็บแล้วล็อกอินใหม่' })
  }
  req.flash('error', 'กรุณาเข้าสู่ระบบก่อน')
  res.redirect('/login')
}

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login')
    }
    if (roles.includes(req.session.user.role)) {
      return next()
    }
    res.status(403).render('error', { 
      message: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้',
      user: req.session.user 
    })
  }
}

const redirectIfAuth = (req, res, next) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard')
  }
  next()
}

module.exports = { requireAuth, requireRole, redirectIfAuth }
