// routes/auth.js
const express = require('express')
const router = express.Router()
const { supabase, supabaseAdmin } = require('../config/supabase')
const { redirectIfAuth } = require('../middleware/auth')

// GET /login
router.get('/login', redirectIfAuth, (req, res) => {
  res.render('auth/login', {
    title: 'เข้าสู่ระบบ',
    error: req.flash('error'),
    success: req.flash('success')
  })
})

// POST /login
router.post('/login', redirectIfAuth, async (req, res) => {
  const { email, password, remember } = req.body

  if (!email || !password) {
    req.flash('error', 'กรุณากรอกอีเมลและรหัสผ่าน')
    return res.redirect('/login')
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    })

    if (error) {
      req.flash('error', 'อีเมล/รหัสผ่านไม่ถูกต้อง หรือยังไม่ได้ยืนยันอีเมล')
      return res.redirect('/login')
    }

    // Get user profile from users table
    const { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single()

    req.session.user = {
      id: data.user.id,
      email: data.user.email,
      name: profile?.name || data.user.email,
      role: profile?.role || 'staff',
      avatar_url: profile?.avatar_url || null
    }

    // Remember me: set cookie for 30 days
    if (remember) {
      res.cookie('rememberedEmail', email, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true })
    } else {
      res.clearCookie('rememberedEmail')
    }

    res.redirect('/dashboard')
  } catch (err) {
    console.error('Login error:', err)
    req.flash('error', 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง')
    res.redirect('/login')
  }
})

// GET /signup
router.get('/signup', redirectIfAuth, (req, res) => {
  res.render('auth/signup', {
    title: 'สมัครสมาชิก',
    error: req.flash('error'),
    success: req.flash('success')
  })
})

// POST /signup
router.post('/signup', redirectIfAuth, async (req, res) => {
  const { name, email, password, password_confirm } = req.body

  if (!name || !email || !password || !password_confirm) {
    req.flash('error', 'กรุณากรอกข้อมูลให้ครบทุกช่อง')
    return res.redirect('/signup')
  }

  if (password !== password_confirm) {
    req.flash('error', 'รหัสผ่านไม่ตรงกัน')
    return res.redirect('/signup')
  }

  if (password.length < 6) {
    req.flash('error', 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
    return res.redirect('/signup')
  }

  try {
    // Sign up user with Supabase auth
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password
    })

    if (error) {
      if (error.message.includes('already registered')) {
        req.flash('error', 'อีเมลนี้ลงทะเบียนแล้ว')
      } else {
        req.flash('error', `สมัครไม่สำเร็จ: ${error.message}`)
      }
      return res.redirect('/signup')
    }

    // Create user profile
    const { error: profileError } = await supabaseAdmin.from('users').insert([{
      id: data.user.id,
      email: data.user.email,
      name,
      role: 'staff',
      is_active: true
    }])

    if (profileError) throw profileError

    req.flash('success', 'สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบ')
    res.redirect('/login')
  } catch (err) {
    console.error('Signup error:', err)
    req.flash('error', 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง')
    res.redirect('/signup')
  }
})

// GET /forgot-password
router.get('/forgot-password', redirectIfAuth, (req, res) => {
  res.render('auth/forgot-password', {
    title: 'ลืมรหัสผ่าน',
    error: req.flash('error'),
    success: req.flash('success')
  })
})

// POST /forgot-password
router.post('/forgot-password', redirectIfAuth, async (req, res) => {
  const { email } = req.body

  if (!email) {
    req.flash('error', 'กรุณากรอกอีเมล')
    return res.redirect('/forgot-password')
  }

  try {
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${process.env.APP_URL || 'http://localhost:3000'}/login`
    })
  } catch (err) {
    console.error('Forgot password error:', err)
  }

  // Always show success (security: don't reveal if email exists)
  req.flash('success', 'ถ้าอีเมลนี้มีอยู่ในระบบ ลิงก์รีเซตจะถูกส่งไปที่อีเมล')
  res.redirect('/forgot-password')
})

// GET /logout
router.get('/logout', async (req, res) => {
  await supabase.auth.signOut().catch(() => {})
  // cookie-session: ล้าง session โดย set เป็น null
  req.session = null
  res.redirect('/login')
})

module.exports = router
