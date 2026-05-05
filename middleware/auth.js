// middleware/auth.js
const requireAuth = (req, res, next) => {
  if (req.session && req.session.user) {
    res.locals.user = req.session.user
    return next()
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
